-- (j) Bảng đúng khuôn tenant (RLS, chính sách, FK cascade, chỉ mục) nhưng không khai báo trong mã.
SET ROLE "owner"; -- đối tượng mới phải thuộc owner, chỉ vi phạm quy tắc đang thử
CREATE TABLE content.fx_j (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account.accounts (id) ON DELETE CASCADE
);
CREATE INDEX fx_j_account_id_idx ON content.fx_j (account_id);
ALTER TABLE content.fx_j ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content.fx_j FOR ALL TO "app", "system"
  USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());
