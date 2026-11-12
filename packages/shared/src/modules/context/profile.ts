import { z } from 'zod';
import { viIssue } from '../../core/vi-error-messages.js';
import { UtcDateTime } from '../../core/primitives.js';
import { INDUSTRY_CODES, type IndustryCode } from './industries.js';
import { charCount, PROFILE_LIMITS } from './limits.js';

// Hợp đồng HTTP của hồ sơ kinh doanh (006 contracts/context-http-api.md, data-model mục 3).
// CÙNG một lược đồ cho web (kiểm trước khi gửi) và máy chủ (`@ValidBody`) → cùng thông điệp (FR-004).
// Chuẩn hóa trước khi kiểm: cắt khoảng trắng đầu/cuối; trường tùy chọn rỗng → null; tên ngành tự do
// bị bỏ khi ngành ≠ "Khác"; từ khóa cắt khoảng trắng, giữ thứ tự.

/** Thông điệp lỗi hợp lệ (nguyên văn – kiểm thử và web dùng lại). */
export const PROFILE_MESSAGES = {
  industryCode: 'Hãy chọn ngành kinh doanh.',
  industryOther: 'Hãy nhập tên ngành của bạn (tối đa 100 ký tự).',
  introduction: 'Hãy viết vài dòng giới thiệu (tối đa 2.000 ký tự).',
  products: 'Phần sản phẩm/dịch vụ dài quá 5.000 ký tự – hãy rút gọn.',
  policies: 'Phần chính sách dài quá 5.000 ký tự – hãy rút gọn.',
  tone: 'Phần giọng văn dài quá 500 ký tự – hãy rút gọn.',
  keywordsMax: 'Tối đa 20 từ khóa – hãy xóa bớt.',
  keywordEmpty: 'Từ khóa không được để trống.',
  keywordTooLong: (k: string) => `Từ khóa "${k}" dài quá 50 ký tự – hãy rút gọn.`,
  keywordDuplicate: (k: string) => `Từ khóa "${k}" bị trùng – hãy xóa bớt.`,
} as const;

/** Nội dung hồ sơ SAU chuẩn hóa – dạng lưu trong CSDL và trả về từ API. */
export interface ProfileFieldsValue {
  industryCode: IndustryCode;
  industryOther: string | null;
  introduction: string;
  products: string | null;
  policies: string | null;
  tone: string | null;
  keywords: string[];
}

const RawProfileFields = z.strictObject({
  // Chuỗi (không z.enum) để thông điệp "Hãy chọn ngành kinh doanh." đi qua superRefine bên dưới.
  industryCode: z.string(),
  industryOther: z.string().nullable(),
  introduction: z.string(),
  products: z.string().nullable(),
  policies: z.string().nullable(),
  tone: z.string().nullable(),
  keywords: z.array(z.string()),
});

/** Trường tùy chọn: cắt khoảng trắng, rỗng → null. */
function optionalText(v: string | null): string | null {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
}

/** Chuẩn hóa (hàm thuần) – dùng chung cho lược đồ và cho so sánh "không có thay đổi". */
export function normalizeProfileFields(raw: z.infer<typeof RawProfileFields>): ProfileFieldsValue {
  const industryCode = raw.industryCode.trim() as IndustryCode;
  return {
    industryCode,
    industryOther: industryCode === 'other' ? optionalText(raw.industryOther) : null,
    introduction: raw.introduction.trim(),
    products: optionalText(raw.products),
    policies: optionalText(raw.policies),
    tone: optionalText(raw.tone),
    keywords: raw.keywords.map((k) => k.trim()),
  };
}

const L = PROFILE_LIMITS;
const M = PROFILE_MESSAGES;

/** Lược đồ đầu vào nội dung hồ sơ: chuẩn hóa + kiểm giới hạn. Trường lạ (vd `accountId`) bị từ chối. */
export const ProfileFields = RawProfileFields.transform(normalizeProfileFields).superRefine(
  (f, ctx) => {
    if (!(INDUSTRY_CODES as readonly string[]).includes(f.industryCode)) {
      ctx.addIssue(viIssue(M.industryCode, ['industryCode']));
    }
    if (f.industryCode === 'other') {
      const n = f.industryOther === null ? 0 : charCount(f.industryOther);
      if (n < 1 || n > L.industryOther) ctx.addIssue(viIssue(M.industryOther, ['industryOther']));
    }
    const intro = charCount(f.introduction);
    if (intro < 1 || intro > L.introduction) {
      ctx.addIssue(viIssue(M.introduction, ['introduction']));
    }
    for (const key of ['products', 'policies', 'tone'] as const) {
      const v = f[key];
      if (v !== null && charCount(v) > L[key]) ctx.addIssue(viIssue(M[key], [key]));
    }
    if (f.keywords.length > L.keywordsMax) ctx.addIssue(viIssue(M.keywordsMax, ['keywords']));
    const seen = new Set<string>();
    f.keywords.forEach((k, i) => {
      if (k === '') {
        ctx.addIssue(viIssue(M.keywordEmpty, ['keywords', i]));
        return;
      }
      if (charCount(k) > L.keywordLength) {
        ctx.addIssue(viIssue(M.keywordTooLong(k), ['keywords', i]));
        return;
      }
      const lower = k.toLocaleLowerCase('vi');
      if (seen.has(lower)) ctx.addIssue(viIssue(M.keywordDuplicate(k), ['keywords', i]));
      seen.add(lower);
    });
  },
);
/** Dạng web gửi lên (trước chuẩn hóa). */
export type ProfileFieldsInput = z.input<typeof ProfileFields>;

/**
 * Nội dung hồ sơ trong PHẢN HỒI: chỉ kiểm cấu trúc, không kiểm giới hạn/mã ngành – dữ liệu cũ vẫn đọc
 * được khi giới hạn hoặc danh mục ngành đổi sau này.
 */
export const ProfileFieldsData = z.object({
  industryCode: z.string(),
  industryOther: z.string().nullable(),
  introduction: z.string(),
  products: z.string().nullable(),
  policies: z.string().nullable(),
  tone: z.string().nullable(),
  keywords: z.array(z.string()),
});
export type ProfileFieldsData = z.infer<typeof ProfileFieldsData>;

/** Người lưu một phiên bản. `left`: đã bị gỡ khỏi tài khoản → web hiện "Thành viên đã rời". */
export const SavedBy = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  memberStatus: z.enum(['active', 'left']),
});
export type SavedBy = z.infer<typeof SavedBy>;

export const ProfileView = z.object({
  profileId: z.uuid(),
  version: z.int().min(1),
  savedAt: UtcDateTime,
  savedBy: SavedBy,
  fields: ProfileFieldsData,
});
export type ProfileView = z.infer<typeof ProfileView>;

export const OPTIONAL_PROFILE_FIELDS = ['products', 'policies', 'tone', 'keywords'] as const;
export type OptionalProfileField = (typeof OPTIONAL_PROFILE_FIELDS)[number];

/** `GET /context/profile`. `profile: null` = chưa có hồ sơ (trạng thái hợp lệ, không phải lỗi). */
export const GetProfileResponse = z.object({
  profile: ProfileView.nullable(),
  missingOptional: z.array(z.enum(OPTIONAL_PROFILE_FIELDS)),
});
export type GetProfileResponse = z.infer<typeof GetProfileResponse>;

/** `PUT /context/profile`. `expectedVersion = 0` = chưa có hồ sơ (lần lưu đầu tiên). */
export const SaveProfileRequest = z.strictObject({
  expectedVersion: z.int().min(0),
  fields: ProfileFields,
});
export type SaveProfileRequest = z.infer<typeof SaveProfileRequest>;
export type SaveProfileRequestInput = z.input<typeof SaveProfileRequest>;

export const SaveProfileResponse = z.object({
  changed: z.boolean(),
  profile: ProfileView,
});
export type SaveProfileResponse = z.infer<typeof SaveProfileResponse>;

/** Số dòng mỗi trang lịch sử phiên bản. */
export const VERSION_PAGE_SIZE = 20;

/** `GET /context/profile/versions?page=`. Tham số truy vấn khác bị bỏ qua (không đọc). */
export const VersionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
export type VersionListQuery = z.infer<typeof VersionListQuery>;

export const VersionListItem = z.object({
  versionId: z.uuid(),
  version: z.int().min(1),
  savedAt: UtcDateTime,
  savedBy: SavedBy,
});
export type VersionListItem = z.infer<typeof VersionListItem>;

export const VersionListResponse = z.object({
  items: z.array(VersionListItem),
  page: z.int().min(1),
  pageSize: z.literal(VERSION_PAGE_SIZE),
  total: z.int().min(0),
});
export type VersionListResponse = z.infer<typeof VersionListResponse>;

/** `GET /context/profile/versions/:versionId`. */
export const VersionIdParam = z.strictObject({ versionId: z.uuid() });
export type VersionIdParam = z.infer<typeof VersionIdParam>;

export const VersionDetailResponse = z.object({
  versionId: z.uuid(),
  version: z.int().min(1),
  savedAt: UtcDateTime,
  savedBy: SavedBy,
  fields: ProfileFieldsData,
  isCurrent: z.boolean(),
});
export type VersionDetailResponse = z.infer<typeof VersionDetailResponse>;
