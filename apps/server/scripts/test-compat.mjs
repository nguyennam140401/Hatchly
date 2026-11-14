// pnpm test:compat – chạy bản code này trên CSDL đã migrate bằng migration của bản mới hơn (008, FR-018).
// Hợp đồng (contracts/quality-gates.md mục 7): nhận COMPAT_DATABASE_{OWNER,APP,SYSTEM,SUPPORT}_URL trỏ tới
// CSDL ĐÃ migrate; KHÔNG tự migrate, KHÔNG xóa/tạo lại schema; mã thoát 0 = chạy được trên cấu trúc mới.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = [
  'COMPAT_DATABASE_OWNER_URL',
  'COMPAT_DATABASE_APP_URL',
  'COMPAT_DATABASE_SYSTEM_URL',
  'COMPAT_DATABASE_SUPPORT_URL',
];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Thiếu biến môi trường: ${missing.join(', ')} (CSDL đã migrate bằng migration của bản mới)`,
  );
  process.exit(2);
}

const run = (command, args) =>
  spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

// api/worker khởi động từ dist – dựng nếu chưa có (bản gốc do db:compat tự cài + build thì đã có).
if (!existsSync(resolve('dist', 'api.js')) || !existsSync(resolve('dist', 'worker.js'))) {
  const built = run('pnpm', ['run', 'build']);
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const result = run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.compat.config.mts']);
process.exit(result.status ?? 1);
