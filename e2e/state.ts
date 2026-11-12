import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Trạng thái do apps/server/src/ops/e2e-env.ts ghi: tên CSDL tạm + tài khoản mẫu.

export interface E2eState {
  dbName: string;
  owner: { email: string; password: string };
  collaborator: { email: string; password: string };
}

export const STATE_FILE = join(import.meta.dirname, 'test-results', 'e2e-state.json');

/** Đọc trạng thái, chờ tối đa `timeoutMs` (API nghe cổng trước khi mồi xong dữ liệu). */
export async function readState(timeoutMs = 30_000): Promise<E2eState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
    if (Date.now() > deadline) throw new Error(`Chưa có ${STATE_FILE}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
