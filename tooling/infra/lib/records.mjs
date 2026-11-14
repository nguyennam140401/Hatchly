// Bản ghi áp dụng và bản ghi diễn tập ở bucket trạng thái (T090, data-model.md mục 6–7). Chỉ-thêm, không sửa.
import { createS3 } from './s3.mjs';
import { run } from './process.mjs';

export const APPLIED_PREFIX = 'records/applied/';
export const DRILLS_PREFIX = 'records/drills/';

const hashDir = (definitionHash) => definitionHash.replace(':', '-');

export const appliedKey = (record) =>
  `${APPLIED_PREFIX}${hashDir(record.definitionHash)}/${record.stack}-${record.appliedAt}.json`;

/** `git config user.name` (người vận hành); không có thì `unknown`. */
export async function operatorName(deps = {}) {
  const r = await (deps.run ?? run)('git', ['config', 'user.name']);
  return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : 'unknown';
}

/**
 * Ghi bản ghi áp dụng bằng chỉ-thêm (`IfNoneMatch: *`): ghi đè bị từ chối.
 * @returns {Promise<string>} khóa đối tượng
 */
export async function writeApplyRecord(env, input, deps = {}) {
  const s3 = deps.s3 ?? createS3(env);
  const record = {
    environment: env,
    stack: input.stack,
    definitionHash: input.definitionHash,
    paramsHash: input.paramsHash,
    gitCommit: input.gitCommit,
    appliedAt: input.appliedAt ?? new Date().toISOString(),
    operator: input.operator ?? (await operatorName(deps)),
    summary: input.summary,
    dataLossConfirmed: input.dataLossConfirmed === true,
    protectedChanges: input.protectedChanges ?? [],
    protectionRemoved: input.protectionRemoved ?? [],
  };
  const key = appliedKey(record);
  await s3.putJson(key, record, { onlyIfAbsent: true });
  return key;
}

/** Các bản ghi áp dụng (mới nhất trước). `last` giới hạn số bản ghi. */
export async function listApplyRecords(env, { last, deps = {} } = {}) {
  const s3 = deps.s3 ?? createS3(env);
  const items = await s3.list(APPLIED_PREFIX);
  const records = [];
  for (const item of items) {
    const record = await s3.getJson(item.key);
    if (record !== null) records.push(record);
  }
  records.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  return last === undefined ? records : records.slice(0, last);
}

/** Bản ghi áp dụng của đúng `definitionHash` ở một môi trường. */
export async function recordsForHash(env, definitionHash, deps = {}) {
  const s3 = deps.s3 ?? createS3(env);
  const items = await s3.list(`${APPLIED_PREFIX}${hashDir(definitionHash)}/`);
  const out = [];
  for (const item of items) {
    const r = await s3.getJson(item.key);
    if (r !== null) out.push(r);
  }
  return out;
}

/** "Đã chạy ở thử nghiệm" ⇔ có bản ghi của CẢ HAI stack với đúng `definitionHash`. */
export async function hasStagingRecord(definitionHash, deps = {}) {
  const records = await recordsForHash('staging', definitionHash, deps);
  const stacks = new Set(records.map((r) => r.stack));
  return stacks.has('cloud') && stacks.has('platform');
}

/** Tập địa chỉ đã được gỡ bảo vệ xóa ở các lần áp dụng TRƯỚC của một môi trường. */
export async function protectionRemovedAddresses(env, deps = {}) {
  const records = await listApplyRecords(env, { deps });
  return new Set(records.flatMap((r) => r.protectionRemoved ?? []));
}

export async function writeDrillRecord(sourceEnv, record, deps = {}) {
  const s3 = deps.s3 ?? createS3(sourceEnv);
  const key = `${DRILLS_PREFIX}${record.startedAt}.json`;
  await s3.putJson(key, record, { onlyIfAbsent: true });
  return key;
}

export async function listDrillRecords(env, { last, deps = {} } = {}) {
  const s3 = deps.s3 ?? createS3(env);
  const items = await s3.list(DRILLS_PREFIX);
  const records = [];
  for (const item of items) {
    const record = await s3.getJson(item.key);
    if (record !== null) records.push(record);
  }
  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return last === undefined ? records : records.slice(0, last);
}
