import { PATH_METADATA } from '@nestjs/common/constants';
import type { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  DuplicateAccessDeclarationError,
  readAccessDeclaration,
  type AccessDeclaration,
} from './access.decorators';

// Duyệt mọi route khi khởi động và trong CI (FR-013, SC-004, R7): mọi handler phải có ĐÚNG MỘT khai
// báo truy cập. Thiếu/trùng → development/test ném lỗi khi khởi động; staging/production ghi `error`
// và guard vẫn từ chối (mặc định từ chối).

export interface AccessScanResult {
  /** `Controller.method` của handler không có khai báo. */
  missing: string[];
  /** `Controller.method` (hoặc Controller) có hơn một khai báo. */
  duplicated: string[];
  /** Mọi handler đã duyệt với khai báo hiệu lực. */
  handlers: { name: string; declaration: AccessDeclaration | null }[];
}

type Handler = (...args: never[]) => unknown;
type ControllerClass = abstract new (...args: never[]) => unknown;

export function scanAccessDeclarations(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
): AccessScanResult {
  const result: AccessScanResult = { missing: [], duplicated: [], handlers: [] };
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as ControllerClass | null | undefined;
    if (typeof metatype !== 'function') continue;
    const prototype = metatype.prototype as Record<string, unknown>;
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const method = prototype[methodName];
      if (typeof method !== 'function') continue;
      // Chỉ handler có đường dẫn (@Get/@Post…) là điểm cuối.
      if (Reflect.getMetadata(PATH_METADATA, method) === undefined) continue;
      const name = `${metatype.name}.${methodName}`;
      try {
        const declaration = readAccessDeclaration(method as Handler, metatype);
        result.handlers.push({ name, declaration });
        if (declaration === null) result.missing.push(name);
      } catch (err) {
        if (!(err instanceof DuplicateAccessDeclarationError)) throw err;
        result.duplicated.push(name);
        result.handlers.push({ name, declaration: null });
      }
    }
  }
  return result;
}

/** Lỗi khởi động (development/test) khi có handler thiếu/trùng khai báo. */
export class AccessDeclarationError extends Error {
  constructor(readonly scan: AccessScanResult) {
    super(
      [
        'Điểm cuối thiếu hoặc trùng khai báo truy cập (@Public/@CustomerAccess/@StaffAccess):',
        ...scan.missing.map((n) => `  - thiếu: ${n}`),
        ...scan.duplicated.map((n) => `  - trùng: ${n}`),
      ].join('\n'),
    );
    this.name = 'AccessDeclarationError';
  }
}
