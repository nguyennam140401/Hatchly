-- Migration tay 0011 (004, research R11, data-model.md mục 5): mở rộng loại người thực hiện của
-- nhật ký kiểm toán thêm 'user' (khách hàng) và 'anonymous' (đăng nhập thất bại, đăng ký). Chỉ MỞ
-- RỘNG tập giá trị nên tương thích ngược: mã cũ (support, admin, system) vẫn ghi được. Áp lên bảng
-- cha phân vùng → lan xuống mọi phân vùng.
ALTER TABLE infra.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
--> statement-breakpoint
ALTER TABLE infra.audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('support', 'admin', 'system', 'user', 'anonymous'));
