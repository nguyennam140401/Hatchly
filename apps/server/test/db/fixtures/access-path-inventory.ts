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
  'view:sandbox.support_note_detail': { proof: 'test/db/support-context.db.spec.ts' },
  'view:sandbox.support_note_search': { proof: 'test/db/support-context.db.spec.ts' },
  // ---- (b) hàm SECURITY DEFINER `app` được gọi ----
  'function:account.auth_find_token': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_lookup_email': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_register': { proof: 'test/db/auth-functions.db.spec.ts' },
  'function:account.auth_resolve_session': { proof: 'test/db/auth-functions.db.spec.ts' },
  // ---- (c) bảng việc nền dùng chung ----
  'table:pgboss.job_common': { proof: 'test/queue/queue-privileges.queue.spec.ts' },
};
