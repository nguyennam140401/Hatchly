-- (l) Bảng tenant có account_id cho phép NULL nhưng đăng ký KHÔNG khai báo nullableTenant.reason
-- (l-nullable-tenant-without-reason.registry.json). Còn lại đúng quy ước: RLS + chính sách + chỉ mục.
SET ROLE "owner"; -- đối tượng mới phải thuộc owner, chỉ vi phạm quy tắc đang thử
CREATE TABLE content.fx_l (
  id uuid PRIMARY KEY,
  account_id uuid NULL REFERENCES account.accounts (id) ON DELETE CASCADE
);
CREATE INDEX fx_l_account_id_idx ON content.fx_l (account_id);
ALTER TABLE content.fx_l ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content.fx_l FOR ALL TO "app", "system"
  USING (account_id = account.current_account_id())
  WITH CHECK (account_id = account.current_account_id());
