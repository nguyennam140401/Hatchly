-- (d) Chỉ mục của bảng tenant không bắt đầu bằng account_id, không có trong indexExceptions.
CREATE INDEX tenant_notes_title_idx ON sandbox.tenant_notes (title);
