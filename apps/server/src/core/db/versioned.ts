/* eslint-disable @typescript-eslint/no-generated-empty-object-type -- bảng chung chung T: kiểu cột/dòng chỉ biết ở nơi gọi */
import { ERROR_CODES } from '@app/shared/core';
import { and, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { AppError } from '../errors/app-error';
import type { Db } from './transaction';

// Khóa lạc quan (FR-019, research R13): cập nhật có điều kiện theo `version`. RLS đã ẩn dòng của
// tenant khác nên "0 dòng" chỉ có nghĩa đã bị sửa hoặc đã xóa – cả hai xử lý như xung đột.

export type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn };

/** Lỗi xung đột phiên bản: HTTP 409, hành động "Tải lại". */
export function versionConflict(): AppError {
  return new AppError({
    code: ERROR_CODES.VERSION_CONFLICT,
    httpStatus: 409,
    message: 'Bài vừa được người khác sửa. Tải lại để xem bản mới nhất.',
    actions: [{ kind: 'retry', label: 'Tải lại' }],
  });
}

/**
 * `UPDATE … SET <values>, version = version + 1, updated_at = now() WHERE id = $id AND version =
 * $expected RETURNING *`. 0 dòng → `VERSION_CONFLICT`.
 */
export async function updateVersioned<T extends VersionedTable>(
  db: Db,
  table: T,
  key: { id: string; expectedVersion: number },
  values: PgUpdateSetSource<T>,
): Promise<T['$inferSelect']> {
  const columns = table as unknown as Record<string, AnyPgColumn | undefined>;
  const version = columns.version;
  const id = columns.id;
  if (version === undefined || id === undefined) {
    throw new Error('updateVersioned chỉ dùng cho bảng có cột id và version (versioned: true)');
  }
  const set: Record<string, unknown> = { ...values, version: sql`${version} + 1` };
  if (columns.updated_at !== undefined) set.updated_at = sql`now()`;

  const rows = (await db
    .update(table)
    .set(set as PgUpdateSetSource<T>)
    .where(and(eq(id, key.id), eq(version, key.expectedVersion)))
    .returning()) as T['$inferSelect'][];
  const row = rows[0];
  if (row === undefined) throw versionConflict();
  return row;
}
