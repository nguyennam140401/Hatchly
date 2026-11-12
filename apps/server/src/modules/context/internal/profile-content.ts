// Hàm THUẦN của hồ sơ kinh doanh (006 research R4) – không CSDL, không NestJS → kiểm thử đơn vị nhóm (a).
import {
  OPTIONAL_PROFILE_FIELDS,
  type IndustryCode,
  type OptionalProfileField,
  type ProfileFieldsValue,
} from '@app/shared/context';
import type { ProfileVersionRow } from './db/schema';

/** Cột nội dung của một dòng `profile_versions`. */
export type ProfileContentColumns = Pick<
  ProfileVersionRow,
  | 'industry_code'
  | 'industry_other'
  | 'introduction'
  | 'products'
  | 'policies'
  | 'tone'
  | 'keywords'
>;

/**
 * Hai nội dung (đã chuẩn hóa bằng `ProfileFields`) có giống nhau không. Từ khóa so theo THỨ TỰ:
 * đổi thứ tự là một thay đổi (người dùng sắp xếp có chủ đích).
 */
export function sameProfileContent(a: ProfileFieldsValue, b: ProfileFieldsValue): boolean {
  return (
    a.industryCode === b.industryCode &&
    a.industryOther === b.industryOther &&
    a.introduction === b.introduction &&
    a.products === b.products &&
    a.policies === b.policies &&
    a.tone === b.tone &&
    a.keywords.length === b.keywords.length &&
    a.keywords.every((k, i) => k === b.keywords[i])
  );
}

/** Dòng CSDL → nội dung hồ sơ (DTO). */
export function rowToFields(row: ProfileContentColumns): ProfileFieldsValue {
  return {
    industryCode: row.industry_code as IndustryCode,
    industryOther: row.industry_other,
    introduction: row.introduction,
    products: row.products,
    policies: row.policies,
    tone: row.tone,
    keywords: [...row.keywords],
  };
}

/** Nội dung hồ sơ → cột CSDL. */
export function fieldsToRow(fields: ProfileFieldsValue): ProfileContentColumns {
  return {
    industry_code: fields.industryCode,
    industry_other: fields.industryOther,
    introduction: fields.introduction,
    products: fields.products,
    policies: fields.policies,
    tone: fields.tone,
    keywords: [...fields.keywords],
  };
}

/** Trường tùy chọn còn trống – dùng cho thẻ gợi ý (FR-007). Chưa có hồ sơ → cả bốn. */
export function missingOptional(fields: ProfileFieldsValue | null): OptionalProfileField[] {
  if (fields === null) return [...OPTIONAL_PROFILE_FIELDS];
  return OPTIONAL_PROFILE_FIELDS.filter((key) =>
    key === 'keywords' ? fields.keywords.length === 0 : fields[key] === null,
  );
}
