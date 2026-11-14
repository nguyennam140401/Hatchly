// Trạng thái vận hành lưu ở bucket trạng thái: `runtime/power.json` (FR-034). CLI đọc để truyền `-var powered=…`.
import { createS3 } from './s3.mjs';

export const POWER_KEY = 'runtime/power.json';

/** `true` nếu chưa có tệp (mặc định bật). `production` luôn bật. */
export async function readPowered(env, deps = {}) {
  if (env === 'production') return true;
  const s3 = deps.s3 ?? createS3(env);
  const state = await s3.getJson(POWER_KEY);
  return state === null ? true : state.powered !== false;
}

export async function writePower(env, powered, by, deps = {}) {
  const s3 = deps.s3 ?? createS3(env);
  await s3.putJson(POWER_KEY, {
    powered,
    changedAt: (deps.now ?? (() => new Date()))().toISOString(),
    by,
  });
}
