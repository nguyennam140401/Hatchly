-- Mẫu vi phạm các luật thêm ở 008 (FR-017): mỗi câu một luật, trên bảng đã có.
ALTER TABLE content.posts ADD COLUMN channel text NOT NULL;
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_status_check CHECK (status <> '');
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_account_fk FOREIGN KEY (account_id) REFERENCES account.accounts (id);
--> statement-breakpoint
ALTER TABLE content.posts ADD CONSTRAINT posts_slug_unique UNIQUE (account_id, slug);
--> statement-breakpoint
CREATE INDEX posts_status_idx ON content.posts (account_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX posts_slug_idx ON "content"."posts" (account_id, slug);
--> statement-breakpoint
DROP TYPE content.post_status;
