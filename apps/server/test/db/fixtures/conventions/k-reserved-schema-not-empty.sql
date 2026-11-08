-- (k) Bảng trong schema dành sẵn approval. Bảng không có account_id, không đăng ký → thêm b, j.
SET ROLE "owner"; -- đối tượng mới phải thuộc owner, chỉ vi phạm quy tắc đang thử
CREATE TABLE approval.fx_k (id uuid PRIMARY KEY);
