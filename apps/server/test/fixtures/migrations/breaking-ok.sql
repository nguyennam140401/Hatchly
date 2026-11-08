-- Mẫu hợp lệ: câu phá vỡ có chú thích breaking-ok ngay dòng trên.
-- breaking-ok: cột title đã ngừng ghi từ bản 1.4, bản 1.5 xóa (lần phát hành thứ hai)
ALTER TABLE "content"."posts" DROP COLUMN "title";
