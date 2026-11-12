-- Migration tay 0013 (006, data-model.md mục 2): phiên bản hồ sơ là lịch sử BẤT BIẾN – chỉ thêm.
-- Thu hồi UPDATE, DELETE của vai trò ứng dụng (quyền mặc định của schema cấp SELECT/INSERT/UPDATE/
-- DELETE cho app, system – 0000). Xóa chỉ qua CASCADE khi xóa tài khoản: khóa ngoại cascade chạy với
-- quyền của chủ bảng (owner), không cần quyền DELETE của app. Chỉ thu hồi quyền → tương thích ngược.
REVOKE UPDATE, DELETE ON context.profile_versions FROM "app", "system";
