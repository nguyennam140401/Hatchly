-- (c) Khóa ngoại từ sandbox sang bảng của schema khác (infra) – không phải account.accounts.
ALTER TABLE sandbox.tenant_notes
  ADD CONSTRAINT fx_c_audit_fk FOREIGN KEY (created_at, id) REFERENCES infra.audit_log (occurred_at, id);
