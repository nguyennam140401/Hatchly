// Tạo / hủy / đổi giờ việc TRONG giao dịch đang mở (contracts/queue-api.md mục 2–3, research R3, R4).
// Mọi lệnh ghi chạy trên kết nối của tenantTx/systemTx → hoàn tác giao dịch = không có việc (FR-007).
// `accountId` lấy từ giao dịch, `traceId` từ ExecutionContext – KHÔNG có tham số accountId (FR-008).
import { getExecutionContext, uuidV7 } from '../../../core';
import type { TxContext } from '../../../core/db/transaction';
import { getJobType, validatePayload } from '../job-types';
import type {
  ChangeResult,
  EnqueueOptions,
  EnqueueResult,
  JobRef,
  JobTypeDefinition,
  PendingState,
  QueueName,
} from '../public-api';
import { queueError } from './errors';
import type { BossDatabase, PgBoss } from './pgboss/boss-loader';
import { requireCurrentTx, txDatabase } from './pgboss/tx-database';

/** Bảng việc của 6 hàng chờ (partition: false → bảng con mặc định của pgboss.job). */
export const JOB_TABLE = 'pgboss.job_common';

const MAX_DEDUPE_KEY = 200;
const MAX_BATCH = 100;
/** Ưu tiên của việc đăng bài trong chỉ mục lấy việc (R6, FR-005). */
const PUBLISH_PRIORITY = 10;

/** Phong bì dữ liệu việc (data-model mục 3). */
export interface JobEnvelope {
  type: string;
  v: number;
  accountId: string | null;
  traceId: string;
  payload: Record<string, unknown>;
  retriedFrom?: { deadJobId: string; traceId: string };
}

/**
 * Các thể hiện pg-boss tạo được việc trong tiến trình (API: bể `app`; Worker: bể điều khiển). Dùng thể
 * hiện đăng ký sau cùng; đóng một thể hiện không làm mất thể hiện khác (vd hai bản Worker kiểm thử).
 * pg-boss chỉ dùng thể hiện này để đọc bộ nhớ đệm hàng chờ – lệnh ghi chạy trên kết nối của giao dịch.
 */
const producers: PgBoss[] = [];

export function setProducer(boss: PgBoss): void {
  if (!producers.includes(boss)) producers.push(boss);
}

/** Gỡ một thể hiện tạo việc (khi bộ chạy / bộ tạo việc đóng). */
export function clearProducer(boss: PgBoss): void {
  const i = producers.indexOf(boss);
  if (i >= 0) producers.splice(i, 1);
}

function requireProducer(): PgBoss {
  const producer = producers[producers.length - 1];
  if (producer === undefined) throw queueError('QUEUE_NOT_STARTED');
  return producer;
}

/** Kiểm loại việc đã đăng ký và phạm vi khớp ngữ cảnh giao dịch. */
function checkContext(def: JobTypeDefinition, tx: TxContext): string | null {
  if (getJobType(def.name) !== def) throw queueError('QUEUE_JOB_TYPE_UNKNOWN');
  if (def.scope === 'tenant' && tx.accountId === null) {
    throw queueError('QUEUE_TENANT_CONTEXT_REQUIRED');
  }
  if (def.scope === 'system' && tx.accountId !== null) {
    throw queueError('QUEUE_SYSTEM_CONTEXT_REQUIRED');
  }
  return tx.accountId === null ? null : tx.accountId.toLowerCase();
}

interface PreparedJob {
  id: string;
  dedupeKey: string;
  envelope: JobEnvelope;
  startAfter: Date | undefined;
}

function prepare(
  def: JobTypeDefinition,
  accountId: string | null,
  payload: unknown,
  opts: EnqueueOptions | undefined,
  extra?: Pick<JobEnvelope, 'retriedFrom'> & { traceId?: string },
): PreparedJob {
  const value = validatePayload(def, payload) as Record<string, unknown>;
  const id = uuidV7();
  const dedupeKey = opts?.dedupeKey ?? `${def.name}:${id}`;
  if (dedupeKey.trim() === '' || dedupeKey.length > MAX_DEDUPE_KEY) {
    throw queueError('QUEUE_DEDUPE_KEY_INVALID');
  }
  const envelope: JobEnvelope = {
    type: def.name,
    v: def.version,
    accountId,
    traceId: extra?.traceId ?? getExecutionContext()?.traceId ?? uuidV7(),
    payload: value,
    ...(extra?.retriedFrom !== undefined ? { retriedFrom: extra.retriedFrom } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > def.maxPayloadBytes) {
    throw queueError('QUEUE_PAYLOAD_TOO_LARGE');
  }
  return { id, dedupeKey, envelope, startAfter: opts?.runAfter };
}

function jobOptions(def: JobTypeDefinition, job: PreparedJob, accountId: string | null) {
  return {
    id: job.id,
    singletonKey: job.dedupeKey,
    ...(accountId !== null ? { group: { id: accountId } } : {}),
    priority: def.queue === 'publish' ? PUBLISH_PRIORITY : 0,
    ...(job.startAfter !== undefined ? { startAfter: job.startAfter } : {}),
    // Lần thử lại tối đa của loại việc (≤ hàng chờ) – monitor của pg-boss cũng tôn trọng khi Worker chết.
    ...(def.retry?.maxRetries !== undefined ? { retryLimit: def.retry.maxRetries } : {}),
  };
}

type LiveState = 'created' | 'retry' | 'active';

const PENDING_STATE: Record<LiveState, PendingState> = {
  created: 'pending',
  retry: 'retry_wait',
  active: 'running',
};

/** Việc đang hiệu lực (chờ · chờ thử lại · đang chạy) theo khóa – trên kết nối của giao dịch. */
async function findLiveByKey(
  db: BossDatabase,
  queue: QueueName,
  key: string,
): Promise<{ id: string; state: LiveState } | undefined> {
  const r = await db.executeSql(
    `SELECT id::text AS id, state::text AS state FROM ${JOB_TABLE}
      WHERE name = $1 AND singleton_key = $2 AND state <= 'active' LIMIT 1`,
    [queue, key],
  );
  return r.rows[0] as { id: string; state: LiveState } | undefined;
}

/** Gửi một việc đã chuẩn bị (dùng chung cho enqueue và chạy lại việc hỏng). */
export async function sendPrepared(
  def: JobTypeDefinition,
  job: PreparedJob,
  accountId: string | null,
  db: BossDatabase,
): Promise<EnqueueResult> {
  const boss = requireProducer();
  // Hai lượt: khóa trùng với một việc vừa xong giữa lúc gửi và lúc tra → gửi lại được.
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await boss.send(def.queue, job.envelope, { ...jobOptions(def, job, accountId), db });
    if (id !== null) return { status: 'created', jobId: id };
    const live = await findLiveByKey(db, def.queue, job.dedupeKey);
    if (live !== undefined) {
      return { status: 'exists', jobId: live.id, state: PENDING_STATE[live.state] };
    }
  }
  // Khóa đang bị một việc không nhìn thấy được chiếm (vd việc của tenant khác – RLS).
  throw queueError('QUEUE_DEDUPE_KEY_CONFLICT');
}

/** Tạo một việc trong giao dịch hiện tại (FR-007…012). */
export async function enqueue<P>(
  def: JobTypeDefinition<P>,
  payload: P,
  opts?: EnqueueOptions,
): Promise<EnqueueResult> {
  const tx = requireCurrentTx();
  const generic = def as JobTypeDefinition;
  const accountId = checkContext(generic, tx);
  const job = prepare(generic, accountId, payload, opts);
  return sendPrepared(generic, job, accountId, txDatabase(tx));
}

/** Tạo việc với phong bì đặt sẵn (chạy lại việc hỏng – R14). Chỉ nội bộ module. */
export async function enqueueRetried(
  def: JobTypeDefinition,
  payload: unknown,
  opts: { dedupeKey: string; traceId: string; retriedFrom: { deadJobId: string; traceId: string } },
): Promise<EnqueueResult> {
  const tx = requireCurrentTx();
  const accountId = checkContext(def, tx);
  const job = prepare(def, accountId, payload, { dedupeKey: opts.dedupeKey }, opts);
  return sendPrepared(def, job, accountId, txDatabase(tx));
}

/** Tạo nhiều việc một câu lệnh, tất cả hoặc không (FR-013). ≤ 100 việc. */
export async function enqueueMany<P>(
  def: JobTypeDefinition<P>,
  items: { payload: P; opts?: EnqueueOptions }[],
): Promise<{ jobIds: string[] }> {
  const tx = requireCurrentTx();
  const generic = def as JobTypeDefinition;
  const accountId = checkContext(generic, tx);
  if (items.length > MAX_BATCH) throw queueError('QUEUE_BATCH_TOO_LARGE');
  if (items.length === 0) return { jobIds: [] };
  const jobs = items.map((item) => prepare(generic, accountId, item.payload, item.opts));
  const keys = jobs.map((j) => j.dedupeKey);
  if (new Set(keys).size !== keys.length) throw queueError('QUEUE_DUPLICATE_IN_BATCH');

  const db = txDatabase(tx);
  const existing = await db.executeSql(
    `SELECT 1 FROM ${JOB_TABLE} WHERE name = $1 AND singleton_key = ANY($2::text[]) AND state <= 'active' LIMIT 1`,
    [def.queue, keys],
  );
  if (existing.rows.length > 0) throw queueError('QUEUE_DUPLICATE_IN_BATCH');

  const boss = requireProducer();
  const ids = await boss.insert(
    def.queue,
    jobs.map((job) => ({ ...jobOptions(generic, job, accountId), data: job.envelope })),
    { db, returnId: true },
  );
  // Một giao dịch khác chen cùng khóa giữa lúc kiểm và lúc chèn → ON CONFLICT bỏ dòng: hủy cả lô.
  if (ids?.length !== jobs.length) throw queueError('QUEUE_DUPLICATE_IN_BATCH');
  return { jobIds: jobs.map((j) => j.id) };
}

type AnyState = LiveState | 'completed' | 'cancelled' | 'failed';

const NOT_PENDING_STATE: Record<
  Exclude<AnyState, 'created' | 'retry'>,
  'running' | 'completed' | 'cancelled' | 'failed'
> = {
  active: 'running',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

/**
 * Khóa dòng việc (FOR UPDATE) trên kết nối của giao dịch: vòng lấy việc dùng SKIP LOCKED nên không thể
 * kích hoạt việc trong lúc ta hủy/đổi giờ. RLS: việc của tenant khác không thấy → not_found.
 */
async function lockJob(
  db: BossDatabase,
  ref: JobRef,
): Promise<{ id: string; queue: QueueName; state: AnyState } | undefined> {
  const r =
    'jobId' in ref
      ? await db.executeSql(
          `SELECT id::text AS id, name AS queue, state::text AS state FROM ${JOB_TABLE}
            WHERE id = $1::uuid FOR UPDATE`,
          [ref.jobId],
        )
      : await db.executeSql(
          // Ưu tiên việc còn hiệu lực; không có thì việc mới nhất mang khóa này.
          `SELECT id::text AS id, name AS queue, state::text AS state FROM ${JOB_TABLE}
            WHERE name = $1 AND singleton_key = $2
            ORDER BY (state <= 'active') DESC, created_on DESC LIMIT 1 FOR UPDATE`,
          [ref.queue, ref.dedupeKey],
        );
  return r.rows[0] as { id: string; queue: QueueName; state: AnyState } | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function change(
  ref: JobRef,
  apply: (boss: PgBoss, db: BossDatabase, job: { id: string; queue: QueueName }) => Promise<void>,
  status: 'cancelled' | 'rescheduled',
): Promise<ChangeResult> {
  const tx = requireCurrentTx();
  if ('jobId' in ref && !UUID.test(ref.jobId)) return { status: 'not_found' };
  const db = txDatabase(tx);
  const job = await lockJob(db, ref);
  if (job === undefined) return { status: 'not_found' };
  if (job.state !== 'created' && job.state !== 'retry') {
    return { status: 'not_pending', jobId: job.id, state: NOT_PENDING_STATE[job.state] };
  }
  await apply(requireProducer(), db, job);
  return { status, jobId: job.id };
}

/** Hủy việc chưa chạy (chờ / chờ thử lại) – FR-011. */
export function cancelJob(ref: JobRef): Promise<ChangeResult> {
  return change(
    ref,
    async (boss, db, job) => {
      await boss.cancel(job.queue, job.id, { db });
    },
    'cancelled',
  );
}

/** Đổi giờ chạy sớm nhất của việc chưa chạy – FR-011. */
export function rescheduleJob(ref: JobRef, runAfter: Date): Promise<ChangeResult> {
  return change(
    ref,
    async (boss, db, job) => {
      await boss.update(job.queue, undefined, { id: job.id, startAfter: runAfter, db });
    },
    'rescheduled',
  );
}
