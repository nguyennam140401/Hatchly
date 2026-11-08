-- (h) Khóa ngoại tới accounts không ON DELETE CASCADE.
ALTER TABLE sandbox.tenant_notes DROP CONSTRAINT tenant_notes_account_id_accounts_id_fk;
ALTER TABLE sandbox.tenant_notes
  ADD CONSTRAINT tenant_notes_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES account.accounts (id);
