-- Migration tay 0002 (research R9, data-model mục 4): app, system chỉ SELECT, UPDATE trên bảng gốc
-- tenant. Tạo/xóa hẳn tài khoản là đường riêng có kiểm soát (module account) – ngoài phạm vi 002.
REVOKE INSERT, DELETE ON account.accounts FROM "app", "system";
