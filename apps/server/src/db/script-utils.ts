import { resolve } from 'node:path';
import { ConfigError } from '../core/config/load-config';
import { normalizePgError } from '../core/db/errors';

/** Thư mục `apps/server/drizzle` – đúng cả khi chạy `tsx src/db/*.ts` lẫn `node dist/db/*.js`. */
export const DRIZZLE_DIR = resolve(__dirname, '..', '..', 'drizzle');

const URL_PATTERN = /postgres(?:ql)?:\/\/\S+/gi;

/** Thông điệp lỗi an toàn để in: không có chuỗi kết nối, mật khẩu hay SQL kèm tham số (SC-008). */
export function describeError(err: unknown): string {
  if (err instanceof ConfigError) return err.message;
  const normalized = normalizePgError(err);
  let text: string;
  if (normalized instanceof Error) {
    const code = (normalized as { code?: unknown }).code;
    text =
      typeof code === 'string' && !normalized.message.includes(code)
        ? `${normalized.message} (mã ${code})`
        : normalized.message;
  } else {
    text = 'Lỗi không xác định';
  }
  return text.replace(URL_PATTERN, '[đã che]');
}

/** Chạy hàm chính của script: lỗi → in thông điệp an toàn, mã thoát `failCode`. */
export function runScript(main: () => Promise<void>, failCode = 1): void {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(`Lỗi: ${describeError(err)}`);
      process.exit(failCode);
    },
  );
}

/** Đổi tên CSDL trong một chuỗi kết nối (giữ nguyên thông tin đăng nhập). */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

/** Tên CSDL trong chuỗi kết nối (rỗng nếu không có). */
export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
