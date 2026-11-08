-- Mẫu sạch: chỉ mở rộng; thao tác trên bảng mới tạo trong cùng tệp được phép.
CREATE TABLE "content"."drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "content"."drafts" ALTER COLUMN "note" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE content.posts ADD COLUMN subtitle text;
--> statement-breakpoint
CREATE FUNCTION content.f() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- DROP TABLE trong thân hàm là chuỗi, không phải câu migration; dấu ; ở đây không tách câu.
  PERFORM 1;
END
$$;
