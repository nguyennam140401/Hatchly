import { reuseOrConflict, rolePoolOrThrow, runTx, type Db } from './transaction';

// HÀM HẠN CHẾ (004, research R4, contracts/authz-api.md mục 5): giao dịch bể `app` KHÔNG đặt ngữ cảnh
// tenant, cho các bước xác thực xảy ra trước khi biết tài khoản. Chỉ dùng để:
//   - gọi 4 hàm SECURITY DEFINER (account.auth_register/_lookup_email/_resolve_session/_find_token);
//   - đọc/ghi bảng dùng chung của xác thực (staff_users, staff_sessions, auth_throttle);
//   - ghi infra.audit_log.
// Bộ gác truy vấn của 002 vẫn bật: chạm bảng `tenant` → dev/test ném TENANT_CONTEXT_MISSING,
// staging/production ghi cảnh báo và RLS trả 0 dòng.
// Quy tắc ranh giới `auth-tx-restricted`: chỉ core/auth/**, modules/account/internal/auth/** và
// modules/queue/internal/smoke/** (008: điểm cuối kiểm tra khói /ops/smoke, ghi infra.smoke_pings
// và tạo việc hệ thống trong một giao dịch, xem tooling/boundaries/build-rules.cjs) được nhập tệp này. KHÔNG xuất qua core/db/index.ts hay core/index.ts.

/** Giao dịch `app` không tenant. Lồng trong một authTx khác thì dùng lại; trong tenantTx → CONFLICT. */
export async function authTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const current = reuseOrConflict('app', null);
  if (current !== undefined) return await fn(current.db);
  return await runTx(rolePoolOrThrow('app', 'Bể CSDL app chưa được khởi tạo'), 'app', null, fn, {
    guard: true,
  });
}
