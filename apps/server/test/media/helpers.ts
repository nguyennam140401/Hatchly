// Tiện ích dùng chung cho kiểm thử e2e thư viện media (014). Kho tệp là bản `memory` của ApiAppModule (môi trường test),
// "trình duyệt" tải thẳng bằng `simulateBrowserUpload`/`simulateBrowserUploadPart`.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorResponse } from '@app/shared/core';
import type { StartUploadResponse } from '@app/shared/media';
import type { Response as TestResponse } from 'supertest';
import { expect } from 'vitest';
import { OBJECT_STORAGE } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import type { Agent, TestApp } from '../auth/helpers/app';
import { asOwner } from '../db/helpers/db';

export const MEDIA = '/api/v1/media';
export const UPLOADS = '/api/v1/media/uploads';

const FIXTURES = resolve(__dirname, '../fixtures/media');

export const fixture = (name: string): Buffer => readFileSync(resolve(FIXTURES, name));

export const storageOf = (t: TestApp): MemoryObjectStorage =>
  t.app.get<MemoryObjectStorage>(OBJECT_STORAGE);

/** Dấu vân tay như web: SHA-256 hex của `tên|dung lượng|lastModified`. */
export function fingerprintOf(
  name: string,
  size: number,
  lastModified = 1_700_000_000_000,
): string {
  return createHash('sha256').update(`${name}|${size}|${lastModified}`).digest('hex');
}

export interface FileSpec {
  name: string;
  bytes: Buffer;
  contentType: string;
  lastModified?: number;
}

export const jpeg = (name = 'anh.jpg'): FileSpec => ({
  name,
  bytes: fixture('plain.jpg'),
  contentType: 'image/jpeg',
});

/** Tệp có nội dung ngẫu nhiên sau phần đầu JPEG hợp lệ – mỗi lần gọi khác dấu tệp. */
export function uniqueJpeg(name = `u-${randomBytes(4).toString('hex')}.jpg`): FileSpec {
  return {
    name,
    bytes: Buffer.concat([fixture('plain.jpg'), randomBytes(64)]),
    contentType: 'image/jpeg',
  };
}

export function startBody(f: FileSpec, over: Record<string, unknown> = {}) {
  return {
    fileName: f.name,
    sizeBytes: f.bytes.length,
    contentType: f.contentType,
    fingerprint: fingerprintOf(f.name, f.bytes.length, f.lastModified),
    ...over,
  };
}

export async function startUpload(
  agent: Agent,
  f: FileSpec,
  over: Record<string, unknown> = {},
): Promise<TestResponse> {
  return agent.post(UPLOADS, startBody(f, over));
}

/** "Trình duyệt" tải tệp một lần lên đường dẫn POST ký sẵn (kho memory). */
export async function browserUploadSingle(
  t: TestApp,
  start: StartUploadResponse,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  if (start.mode !== 'single') throw new Error('không phải chế độ single');
  await storageOf(t).simulateBrowserUpload({ fields: start.post.fields }, bytes, contentType);
}

/** Bắt đầu + tải + xác nhận một tệp nhỏ; trả mã media và phiên. */
export async function uploadAndComplete(t: TestApp, agent: Agent, f: FileSpec) {
  const started = await startUpload(agent, f);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const body = started.body as StartUploadResponse;
  await browserUploadSingle(t, body, f.bytes, f.contentType);
  const done = await agent.post(`${UPLOADS}/${body.uploadId}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(202);
  return { uploadId: body.uploadId, mediaId: body.mediaId };
}

export function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): ErrorResponse['error'] {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  const error = parsed.data!.error;
  expect(error.code).toBe(code);
  expect(error.actions.length).toBeGreaterThanOrEqual(1);
  return error;
}

/** Số việc `media.process` đã tạo cho một media (dữ liệu việc chỉ có mã tham chiếu). */
export async function processJobCount(mediaId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pgboss.job
        WHERE data->>'type' = 'media.process' AND data->'payload'->>'mediaId' = $1`,
      [mediaId],
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

export async function jobCount(type: string, mediaId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pgboss.job
        WHERE data->>'type' = $1 AND data->'payload'->>'mediaId' = $2`,
      [type, mediaId],
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

export async function mediaRows(accountId: string): Promise<Record<string, unknown>[]> {
  return asOwner(async (c) => {
    const r = await c.query(
      'SELECT id, status, original_bytes, deleted_at FROM media.media WHERE account_id = $1 ORDER BY created_at',
      [accountId],
    );
    return r.rows as Record<string, unknown>[];
  });
}

export async function quotaRow(
  accountId: string,
): Promise<{ used: number; reserved: number } | null> {
  return asOwner(async (c) => {
    const r = await c.query<{ used_bytes: string; reserved_bytes: string }>(
      'SELECT used_bytes::text, reserved_bytes::text FROM media.storage_quotas WHERE account_id = $1',
      [accountId],
    );
    const row = r.rows[0];
    return row === undefined
      ? null
      : { used: Number(row.used_bytes), reserved: Number(row.reserved_bytes) };
  });
}
