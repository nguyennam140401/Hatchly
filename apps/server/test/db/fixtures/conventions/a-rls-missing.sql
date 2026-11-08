-- (a) Bảng có account_id, đã đăng ký tenant (a-rls-missing.registry.json) nhưng KHÔNG bật RLS.
SET ROLE "owner"; -- đối tượng mới phải thuộc owner, chỉ vi phạm quy tắc đang thử
CREATE TABLE content.fx_a (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account.accounts (id) ON DELETE CASCADE
);
CREATE INDEX fx_a_account_id_idx ON content.fx_a (account_id);
