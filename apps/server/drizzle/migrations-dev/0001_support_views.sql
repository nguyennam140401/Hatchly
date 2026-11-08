-- Migration dev tay 0001 (data-model mục 8, research R11): khung nhìn hỗ trợ MẪU.
-- Do "owner" sở hữu, KHÔNG security_invoker → đọc vượt RLS của bảng gốc. Vì vậy CHỈ cấp cho
-- "support"; cấp cho "app"/"system" là rò dữ liệu chéo tenant (quy tắc i-support-view-leak).

-- Tìm kiếm xuyên tài khoản: chỉ mã tài khoản, mã đối tượng, trạng thái – không có nội dung.
CREATE VIEW sandbox.support_note_search AS
  SELECT account_id, id AS object_id, status
  FROM sandbox.tenant_notes
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Chi tiết MỘT tài khoản: lọc tường minh theo ngữ cảnh tenant; không có cột secret_note.
CREATE VIEW sandbox.support_note_detail AS
  SELECT account_id, id, title, status, created_at, updated_at
  FROM sandbox.tenant_notes
  WHERE account_id = account.current_account_id();
--> statement-breakpoint
GRANT SELECT ON sandbox.support_note_search, sandbox.support_note_detail TO "support";
