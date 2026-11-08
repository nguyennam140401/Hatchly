-- Mẫu vi phạm: mỗi câu dưới đây phá tương thích ngược với bản đang chạy.
ALTER TABLE "content"."posts" DROP COLUMN "title";
--> statement-breakpoint
ALTER TABLE content.posts RENAME COLUMN body TO content;
--> statement-breakpoint
ALTER TABLE content.posts ALTER COLUMN status SET NOT NULL;
--> statement-breakpoint
ALTER TABLE content.posts ALTER COLUMN status TYPE varchar(20);
--> statement-breakpoint
DROP TABLE content.old_posts;
