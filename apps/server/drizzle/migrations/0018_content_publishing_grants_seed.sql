-- Migration tay 0018 (012, data-model.md mục 1.3, 1.4, 7): quyền + dữ liệu khởi tạo cho bảng của 0017.
-- Chỉ thêm / chỉ thu hồi quyền → tương thích ngược (API, Worker cũ không chạm bảng mới).

-- 1) Lịch sử sự kiện của bài là CHỈ THÊM: thu hồi UPDATE, DELETE của vai trò ứng dụng. Dòng chỉ mất theo
--    CASCADE khi bài hoặc tài khoản bị xóa hẳn (khóa ngoại cascade chạy với quyền của chủ bảng).
REVOKE UPDATE, DELETE ON content.post_events FROM "app", "system";

-- 2) Bộ giới hạn theo kênh là cấu hình chung: ứng dụng chỉ ĐỌC. Đổi giới hạn = cập nhật dòng bằng vai trò
--    chủ sở hữu (không cần phát hành). Quyền mặc định của schema cấp INSERT/UPDATE/DELETE (0000).
REVOKE INSERT, UPDATE, DELETE ON content.channel_rules FROM "app", "system";

-- 3) Dữ liệu khởi tạo (giá trị khởi đầu; Zalo OA và Instagram cần xác minh ở POC-2 – plan R-C).
--    Facebook 63.206 ký tự; Instagram 2.200 ký tự, tối đa 30 hashtag, bắt buộc media, 25 bài/24 giờ
--    (hạn mức cục bộ làm chốt, 013 kiểm tra lại lúc đăng); Zalo OA theo hạn mức hiện hành.
INSERT INTO content.channel_rules (channel_type, max_text_length, max_hashtags, media_required, max_posts_per_24h)
VALUES
  ('facebook_page', 63206, NULL, false, NULL),
  ('instagram', 2200, 30, true, 25),
  ('zalo_oa', 2000, NULL, false, NULL),
  ('test_channel', 63206, NULL, false, NULL)
ON CONFLICT (channel_type) DO NOTHING;
