// Danh mục fixture truy cập chéo (006 R13, FR-023) – MỖI bảng `tenant` của ứng dụng phải có MỘT mục ở
// đây hoặc trong `CROSS_TENANT_EXEMPT` (bảng đã có spec riêng). `cross-tenant-coverage.db.spec.ts` đọc
// sổ đăng ký bảng và báo lỗi khi có bảng mới chưa khai báo – quên là bị bắt.
// Chép mẫu: thêm bảng tenant mới → thêm một mục `{ table, insertRow, updateRow, … }` dưới đây.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { formerMembers, invitations } from '../../../src/modules/account/internal/db/schema';
import { businessProfiles, profileVersions } from '../../../src/modules/context/internal/db/schema';
import {
  channelVariants,
  postEvents,
  posts,
} from '../../../src/modules/content/internal/db/schema';
import { publishAttempts } from '../../../src/modules/publishing/internal/db/schema';
import type { CrossTenantOptions } from '../helpers/cross-tenant';

/** Hồ sơ của tài khoản (lấy hoặc tạo) – dữ liệu cha cho `profile_versions`. */
async function profileOf(db: Db, accountId: string): Promise<{ profileId: string }> {
  const found = await db
    .select({ id: businessProfiles.id })
    .from(businessProfiles)
    .where(eq(businessProfiles.account_id, accountId))
    .limit(1);
  if (found[0] !== undefined) return { profileId: found[0].id };
  const id = uuidV7();
  await db.insert(businessProfiles).values({ id, account_id: accountId });
  return { profileId: id };
}

let versionSeq = 0;

/** Bài nháp của tài khoản (lấy hoặc tạo) – dữ liệu cha cho `channel_variants`, `post_events` (012). */
async function postOf(db: Db, accountId: string): Promise<{ postId: string }> {
  const found = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.account_id, accountId))
    .limit(1);
  if (found[0] !== undefined) return { postId: found[0].id };
  const id = uuidV7();
  await db
    .insert(posts)
    .values({ id, account_id: accountId, status: 'draft', created_by: uuidV7() });
  return { postId: id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- danh mục chứa nhiều kiểu bảng/cha
type AnyFixture = CrossTenantOptions<PgTable, any>;

/** `schema.table` → fixture. */
export const CROSS_TENANT_FIXTURES: Record<string, AnyFixture> = {
  // 009: lời mời đã đóng (không chiếm ghế – tránh chỉ mục duy nhất theo ghế của lời mời đang chờ).
  'account.invitations': {
    table: invitations,
    insertRow: () => {
      const email = `moi.${randomBytes(6).toString('hex')}@example.test`;
      return {
        email,
        email_normalized: email,
        invited_by_user_id: uuidV7(),
        seat: 1,
        status: 'cancelled' as const,
        token_hash: randomBytes(32),
        last_sent_at: new Date(),
        expires_at: new Date(Date.now() + 86_400_000),
        closed_at: new Date(),
      };
    },
    updateRow: () => ({ account_label: 'sửa' }),
  } satisfies CrossTenantOptions<typeof invitations>,
  'account.former_members': {
    table: formerMembers,
    insertRow: () => ({
      user_id: uuidV7(),
      display_name: 'Thành viên cũ',
      removed_by_user_id: uuidV7(),
    }),
    updateRow: () => ({ display_name: 'sửa' }),
  } satisfies CrossTenantOptions<typeof formerMembers>,
  'context.business_profiles': {
    table: businessProfiles,
    onePerAccount: true,
    insertRow: () => ({}),
    updateRow: () => ({ updated_at: new Date() }),
  } satisfies CrossTenantOptions<typeof businessProfiles>,
  'context.profile_versions': {
    table: profileVersions,
    seedParent: profileOf,
    insertRow: (parent: { profileId: string }) => ({
      profile_id: parent.profileId,
      version_number: ++versionSeq,
      industry_code: 'fashion',
      introduction: 'Giới thiệu thử',
      saved_by_user_id: uuidV7(),
    }),
    updateRow: () => ({ tone: 'sửa' }),
    appendOnly: { reason: 'Lịch sử bất biến – migration 0013 thu hồi UPDATE, DELETE của app' },
  } satisfies CrossTenantOptions<typeof profileVersions, { profileId: string }>,
  // 012: bài viết, phiên bản theo kênh, lịch sử sự kiện (chỉ thêm), mục lịch đăng.
  'content.posts': {
    table: posts,
    insertRow: () => ({ status: 'draft', created_by: uuidV7(), shared_text: 'Bài thử' }),
    updateRow: () => ({ shared_text: 'sửa' }),
  } satisfies CrossTenantOptions<typeof posts>,
  'content.channel_variants': {
    table: channelVariants,
    seedParent: postOf,
    insertRow: (parent: { postId: string }) => ({
      post_id: parent.postId,
      connection_id: uuidV7(),
      channel_type: 'test_channel',
    }),
    updateRow: () => ({ text: 'sửa', customized: true }),
  } satisfies CrossTenantOptions<typeof channelVariants, { postId: string }>,
  'content.post_events': {
    table: postEvents,
    seedParent: postOf,
    insertRow: (parent: { postId: string }) => ({
      post_id: parent.postId,
      type: 'created',
      actor_user_id: uuidV7(),
    }),
    updateRow: () => ({ type: 'submitted' }),
    appendOnly: { reason: 'Lịch sử chỉ thêm – migration 0018 thu hồi UPDATE, DELETE của app' },
  } satisfies CrossTenantOptions<typeof postEvents, { postId: string }>,
  'publishing.publish_attempts': {
    table: publishAttempts,
    insertRow: () => ({
      post_id: uuidV7(),
      channel_connection_id: uuidV7(),
      channel_type: 'test_channel',
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 3_600_000),
      content_version: 1,
    }),
    updateRow: () => ({ status: 'cancelled' }),
  } satisfies CrossTenantOptions<typeof publishAttempts>,
};

/** Bảng tenant đã có spec truy cập chéo riêng (không chạy lại ở đây) – lý do trỏ tệp spec. */
export const CROSS_TENANT_EXEMPT: Record<string, string> = {
  'account.accounts': 'bảng gốc tenant – test/db/accounts-isolation.db.spec.ts',
  'account.users': 'mồi qua auth_register – test/db/auth-isolation.db.spec.ts',
  'account.login_identities': 'test/db/auth-isolation.db.spec.ts',
  'account.memberships': 'test/db/auth-isolation.db.spec.ts',
  'account.sessions': 'test/db/auth-isolation.db.spec.ts',
  'account.auth_tokens': 'test/db/auth-isolation.db.spec.ts',
  'infra.dead_jobs': 'account_id cho phép NULL – test/db/dead-jobs-isolation.db.spec.ts',
  // 008 (FR-014): bảng bị sổ đăng ký bỏ sót, catalog phát hiện – đã có spec riêng.
  'infra.audit_log':
    'nhật ký kiểm toán phân vùng, account_id cho phép NULL – test/db/privileges.db.spec.ts, test/db/account-deletion.db.spec.ts',
  'sandbox.ai_fake_budgets':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.ai_fake_cost_ledger':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.ai_fake_reservations':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.fake_scenarios':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.ntf_fake_events':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.ntf_fake_notifications':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.pg_fake_connections':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.pg_fake_oauth_states':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.pg_fake_posts':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.pg_fake_selections':
    'bản giả lập (chỉ dev/test) – test/db/sandbox-fakes-isolation.db.spec.ts',
  'sandbox.tenant_notes': 'bảng mẫu chỉ có trong kiểm thử – test/db/tenant-isolation.db.spec.ts',
};
