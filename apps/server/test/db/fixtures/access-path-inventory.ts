// Kiểm kê đường vào dữ liệu NGOÀI bảng tenant thường (008, FR-015, R10): khung nhìn mà `app`/`support`
// được SELECT, hàm SECURITY DEFINER mà `app` được EXECUTE, và bảng việc nền chung `pgboss.job_common`.
// `access-path-inventory.db.spec.ts` lấy danh sách từ catalog – mục có trong catalog mà không có ở đây
// → đỏ (thông điệp nêu tên). Mỗi mục: `proof` = tệp spec chứng minh `app` trong ngữ cảnh tài khoản A không
// lấy được dữ liệu tài khoản B, hoặc `exempt` = lý do không chứa dữ liệu khách hàng / không cần chứng minh.
export type AccessPathEntry = { proof: string } | { exempt: string };

export const ACCESS_PATH_INVENTORY: Record<string, AccessPathEntry> = {
  // ---- (a) khung nhìn ----
  'view:infra.support_dead_jobs_detail': { proof: 'test/db/dead-jobs-isolation.db.spec.ts' },
  'view:infra.support_dead_jobs_search': { proof: 'test/db/dead-jobs-isolation.db.spec.ts' },
  // 010: khung nhìn hỗ trợ kênh – lọc theo ngữ cảnh tenant, không có cột bản mã.
  'view:platform_gateway.support_channel_view': {
    proof: 'test/db/platform-gateway/support-view.db.spec.ts',
  },
  // 015: khung nhìn hỗ trợ Cổng AI – lọc theo account.current_account_id(), chỉ cấp SELECT cho support,
  // không có cột lời nhắc/văn bản kết quả/bí mật (0030_ai_gateway_seed_support.sql).
  'view:ai_gateway.support_ai_budget_detail': {
    proof: 'test/ai_gateway/support-views.db.spec.ts',
  },
  'view:ai_gateway.support_ai_cost_ledger': {
    proof: 'test/ai_gateway/support-views.db.spec.ts',
  },
  'view:ai_gateway.support_ai_trend_allocations': {
    proof: 'test/ai_gateway/support-views.db.spec.ts',
  },
  'view:sandbox.support_note_detail': { proof: 'test/db/support-context.db.spec.ts' },
  'view:sandbox.support_note_search': { proof: 'test/db/support-context.db.spec.ts' },
  // ---- (b) hàm SECURITY DEFINER `app` được gọi ----
  'function:account.auth_find_token': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_lookup_email': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_register': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_resolve_session': { proof: 'test/db/auth-functions.db.spec.ts' },
  // 009 (migration 0016): hàm của đăng nhập qua nhà cung cấp, lời mời, tài khoản chờ.
  'function:account.auth_accept_invitation_existing': {
    proof: 'test/db/social-functions.db.spec.ts',
  },
  'function:account.auth_accept_invitation_new': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.auth_find_invitation': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.auth_invitation_account': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.auth_lookup_identity': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.auth_pending_invitations_for_email': {
    proof: 'test/db/social-functions.db.spec.ts',
  },
  'function:account.auth_register_oauth': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.auth_resolve_session_v2': { proof: 'test/db/social-functions.db.spec.ts' },
  'function:account.member_detach': { proof: 'test/db/invitations-isolation.db.spec.ts' },
  // ---- (c) bảng việc nền dùng chung ----
  'table:pgboss.job_common': { proof: 'test/queue/queue-privileges.queue.spec.ts' },
};
