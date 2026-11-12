import type { IndustryCode } from '@app/shared/context';

/**
 * Giao diện công khai của module Ngữ cảnh kinh doanh (`context`) – 006 contracts/context-public-api.md.
 *
 * Trách nhiệm (ADD mục 6): Hồ sơ kinh doanh, sản phẩm/dịch vụ, giọng văn, đối tượng khách hàng – đầu vào cho tạo nội dung bằng AI.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `context` trong `allowedDeps` của mình ở modules.manifest.json.
 */
export interface ContextPublicApi {
  /**
   * Hồ sơ hiện hành của tài khoản trong ngữ cảnh (yêu cầu API hoặc việc nền).
   * - Chưa có hồ sơ → null (không phải lỗi).
   * - Không có ngữ cảnh tenant → ném TENANT_CONTEXT_MISSING (lỗi lập trình).
   * - Luôn đọc CSDL, không cache (FR-015).
   */
  getCurrentProfile(): Promise<CurrentBusinessProfile | null>;
}

/**
 * Hồ sơ hiện hành cho module khác (data-model mục 6). CHỈ trường nghiệp vụ – không `accountId`,
 * không người lưu, không thông tin liên hệ chủ tài khoản (FR-014, nguyên tắc VII).
 */
export interface CurrentBusinessProfile {
  profileId: string;
  version: number;
  /** ISO 8601 UTC. */
  savedAt: string;
  industryCode: IndustryCode;
  industryOther: string | null;
  introduction: string;
  products: string | null;
  policies: string | null;
  tone: string | null;
  keywords: string[];
}

/** Token NestJS của ContextPublicApi. */
export const CONTEXT_PUBLIC_API = Symbol('CONTEXT_PUBLIC_API');
