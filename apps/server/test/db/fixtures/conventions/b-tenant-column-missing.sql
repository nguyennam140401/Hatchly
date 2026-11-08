-- (b) Bảng khai báo là tenant nhưng quên cột account_id (không phải bảng dùng chung).
SET ROLE "owner"; -- đối tượng mới phải thuộc owner, chỉ vi phạm quy tắc đang thử
CREATE TABLE content.fx_b (id uuid PRIMARY KEY, name text NOT NULL);
