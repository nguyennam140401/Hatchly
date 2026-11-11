import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import { setGatewayLogSink } from '../../src/core/gateways/op-log';
import type { LogDestination } from '../../src/core/logging/logging.module';

// Thiết lập chung của mọi cấu hình Vitest phía máy chủ (005, T011, SC-009): nhật ký thao tác cổng (và
// nhật ký ứng dụng của các bộ kiểm thử dựng app với `testLogDestination`) ghi ra
// `apps/server/test-logs/<tệp-kiểm-thử>.ndjson`; `pnpm verify` quét thư mục này tìm chuỗi canary
// (`fake_tok_`, `PROMPT_CANARY_`, `POST_CANARY_`) và bí mật.

export const TEST_LOG_DIR = resolve(__dirname, '..', '..', 'test-logs');

let file: string | undefined;

function write(line: string): void {
  if (file === undefined) return;
  appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
}

/** Đích nhật ký cho `ApiAppModule.forRoot(config, { logDestination })` trong kiểm thử. */
export const testLogDestination: LogDestination = { write: (chunk: string) => write(chunk) };

beforeAll(() => {
  const testPath = expect.getState().testPath ?? 'unknown';
  mkdirSync(TEST_LOG_DIR, { recursive: true });
  file = resolve(TEST_LOG_DIR, `${basename(testPath).replace(/\.[cm]?ts$/, '')}.ndjson`);
  // Mỗi lượt chạy ghi lại từ đầu – nhật ký mẫu luôn khớp lượt kiểm thử mới nhất.
  writeFileSync(file, '', 'utf8');
  setGatewayLogSink({ write: (entry) => write(JSON.stringify(entry)) });
});

afterAll(() => {
  setGatewayLogSink(undefined);
});
