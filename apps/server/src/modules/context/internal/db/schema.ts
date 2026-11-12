// Bảng của module Ngữ cảnh kinh doanh (006 data-model.md mục 1–2) – MẪU cho bảng nghiệp vụ mới:
// `tenantTable` tự thêm id UUID v7, account_id NOT NULL FK cascade, chỉ mục (account_id), chính sách
// RLS `tenant_isolation`; ở đây chỉ khai báo cột nghiệp vụ, CHECK (lớp chặn thứ hai sau lược đồ Zod)
// và chỉ mục bắt đầu bằng account_id.
import { sql } from 'drizzle-orm';
import { check, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
// Nhập thẳng core/db (không qua core/index.ts) để drizzle-kit nạp lược đồ không kéo theo NestJS.
import { moduleSchema, tenantTable } from '../../../../core/db';

const context = moduleSchema('context');

/**
 * Hồ sơ kinh doanh – tối đa 1 dòng/tài khoản. `version` (tự có, versioned) = số phiên bản hiện hành,
 * đồng thời là khóa lạc quan cho `updateVersioned`. Nội dung nằm ở `profile_versions`.
 */
export const businessProfiles = tenantTable(
  context,
  'business_profiles',
  {},
  (t) => [uniqueIndex('business_profiles_account_id_key').on(t.account_id)],
  { softDelete: true, versioned: true },
);

/**
 * Phiên bản hồ sơ – lịch sử BẤT BIẾN: chỉ INSERT. Migration 0013 thu hồi UPDATE/DELETE của `app`,
 * `system`; dòng chỉ mất theo CASCADE khi xóa tài khoản (vòng đời dữ liệu).
 */
export const profileVersions = tenantTable(
  context,
  'profile_versions',
  {
    // FK NỘI BỘ module (được phép – nguyên tắc IV).
    profile_id: uuid('profile_id')
      .notNull()
      .references(() => businessProfiles.id, { onDelete: 'cascade' }),
    version_number: integer('version_number').notNull(),
    industry_code: text('industry_code').notNull(),
    industry_other: text('industry_other'),
    introduction: text('introduction').notNull(),
    products: text('products'),
    policies: text('policies'),
    tone: text('tone'),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Người lưu thuộc module `account` → chỉ là MÃ THAM CHIẾU, KHÔNG FK (ADR-09). Tên hiển thị đọc
    // qua AccountPublicApi.describeMembers – không sao chép tên người vào bảng của module này.
    saved_by_user_id: uuid('saved_by_user_id').notNull(),
  },
  (t) => [
    uniqueIndex('profile_versions_account_profile_version_key').on(
      t.account_id,
      t.profile_id,
      t.version_number,
    ),
    check('profile_versions_version_number_check', sql`${t.version_number} >= 1`),
    check(
      'profile_versions_industry_code_length',
      sql`char_length(${t.industry_code}) BETWEEN 1 AND 50`,
    ),
    check(
      'profile_versions_industry_other_length',
      sql`${t.industry_other} IS NULL OR char_length(${t.industry_other}) <= 100`,
    ),
    check(
      'profile_versions_industry_other_when_other',
      sql`(${t.industry_code} = 'other') = (${t.industry_other} IS NOT NULL)`,
    ),
    check(
      'profile_versions_introduction_length',
      sql`char_length(${t.introduction}) BETWEEN 1 AND 2000`,
    ),
    check(
      'profile_versions_products_length',
      sql`${t.products} IS NULL OR char_length(${t.products}) <= 5000`,
    ),
    check(
      'profile_versions_policies_length',
      sql`${t.policies} IS NULL OR char_length(${t.policies}) <= 5000`,
    ),
    check('profile_versions_tone_length', sql`${t.tone} IS NULL OR char_length(${t.tone}) <= 500`),
    check('profile_versions_keywords_count', sql`cardinality(${t.keywords}) <= 20`),
  ],
);

export type BusinessProfileRow = typeof businessProfiles.$inferSelect;
export type ProfileVersionRow = typeof profileVersions.$inferSelect;
