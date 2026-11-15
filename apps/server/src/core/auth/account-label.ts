// Cổng đảo phụ thuộc lõi ↔ module `context` (009, research R17, contracts/module-api.md mục 1): thư mời
// và thư gỡ cần TÊN CỬA HÀNG, nhưng module `account` không được nhập `context` (chiều phụ thuộc
// ngược). Lõi khai báo giao diện + token; `context` cung cấp; `account` tiêm `@Optional()`. Cùng kiểu
// với SESSION_RESOLVER.

export const ACCOUNT_LABEL_RESOLVER = Symbol('ACCOUNT_LABEL_RESOLVER');

export interface AccountLabelResolver {
  /**
   * Tên cửa hàng của tài khoản trong ngữ cảnh; `null` nếu chưa có hồ sơ. Chạy trong tenantTx của người
   * gọi – không nhận mã tài khoản (nguyên tắc I).
   */
  currentAccountLabel(): Promise<string | null>;
}
