-- Mẫu hợp lệ cho các luật thêm ở 008: cùng mục đích với tệp vi phạm nhưng viết theo cách mở rộng.
ALTER TABLE content.posts ADD COLUMN channel text NOT NULL DEFAULT 'facebook';
--> statement-breakpoint
ALTER TABLE content.posts ADD COLUMN subtitle text, ADD COLUMN pinned boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_status_check CHECK (status <> '') NOT VALID;
--> statement-breakpoint
ALTER TABLE content.posts VALIDATE CONSTRAINT posts_status_check;
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_account_fk FOREIGN KEY (account_id) REFERENCES account.accounts (id) NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY posts_slug_idx ON content.posts (account_id, slug);
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_slug_unique UNIQUE USING INDEX posts_slug_idx;
--> statement-breakpoint
-- Bảng tạo trong chính tệp này: chưa bản nào đang dùng nên không tính.
CREATE TABLE content.drafts (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE content.drafts ADD COLUMN title text NOT NULL;
--> statement-breakpoint
ALTER TABLE content.drafts ADD CONSTRAINT drafts_title_check CHECK (title <> '');
--> statement-breakpoint
CREATE INDEX drafts_account_idx ON content.drafts (account_id);
--> statement-breakpoint
CREATE TYPE content.draft_kind AS ENUM ('text', 'image');
--> statement-breakpoint
-- breaking-ok: bảng posts còn dưới 1.000 dòng, khóa ghi dưới một giây
CREATE INDEX posts_created_idx ON content.posts (account_id, created_at);
