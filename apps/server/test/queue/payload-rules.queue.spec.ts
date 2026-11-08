// 003 T021 – US1 AS6, FR-012: dữ liệu việc sai khuôn / quá lớn / loại chưa khai báo → lỗi và giao dịch
// bị hoàn tác (dòng nghiệp vụ không còn).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, type JobTypeDefinition } from '../../src/modules/queue';
import { tenantNotes } from '../db/sandbox/schema';
import { startTestProducer } from '../support/queue-test-kit';
import {
  countByAccount,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const mediaJob = defineJobType({
  name: 'sandbox.media_probe',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  maxPayloadBytes: 512,
  payload: z.strictObject({ mediaId: z.uuid(), labels: z.array(z.string().max(100)).max(50) }),
});

describeDb('US1 – quy tắc dữ liệu việc', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(resetQueues);

  /** Chèn một dòng nghiệp vụ rồi gọi `act` trong cùng giao dịch – mong đợi lỗi mã `code`. */
  async function expectRolledBack(code: string, act: () => Promise<unknown>): Promise<void> {
    await expect(
      withAccount(a, () =>
        tenantTx(async (db) => {
          await db.insert(tenantNotes).values({ account_id: a, title: 'phải bị hoàn tác' });
          await act();
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ detail: code }));
    expect((await countByAccount('sandbox.tenant_notes'))[a] ?? 0).toBe(0);
    expect(await jobs()).toHaveLength(0);
  }

  it('sai khuôn (thiếu trường, sai kiểu, thừa trường) → QUEUE_PAYLOAD_INVALID, hoàn tác', async () => {
    await expectRolledBack('QUEUE_PAYLOAD_INVALID', () =>
      enqueue(mediaJob, { mediaId: 'không-phải-uuid', labels: [] }),
    );
    await expectRolledBack('QUEUE_PAYLOAD_INVALID', () =>
      enqueue(mediaJob, { mediaId: crypto.randomUUID(), labels: [], extra: 1 } as never),
    );
  });

  it('phong bì > maxPayloadBytes → QUEUE_PAYLOAD_TOO_LARGE, hoàn tác', async () => {
    await expectRolledBack('QUEUE_PAYLOAD_TOO_LARGE', () =>
      enqueue(mediaJob, {
        mediaId: crypto.randomUUID(),
        labels: Array.from({ length: 10 }, () => 'n'.repeat(60)),
      }),
    );
  });

  it('loại việc chưa khai báo trong tiến trình → QUEUE_JOB_TYPE_UNKNOWN, hoàn tác', async () => {
    const fake = { ...mediaJob, name: 'sandbox.not_registered' } as JobTypeDefinition;
    await expectRolledBack('QUEUE_JOB_TYPE_UNKNOWN', () =>
      enqueue(fake, { mediaId: crypto.randomUUID() }),
    );
  });

  it('khóa chống trùng rỗng hoặc > 200 ký tự → QUEUE_DEDUPE_KEY_INVALID', async () => {
    await expectRolledBack('QUEUE_DEDUPE_KEY_INVALID', () =>
      enqueue(
        mediaJob,
        { mediaId: crypto.randomUUID(), labels: [] },
        { dedupeKey: 'k'.repeat(201) },
      ),
    );
  });

  it('đúng khuôn → tạo được (đối chứng)', async () => {
    const r = await withAccount(a, () =>
      tenantTx(() => enqueue(mediaJob, { mediaId: crypto.randomUUID(), labels: ['a'] })),
    );
    expect(r.status).toBe('created');
  });
});
