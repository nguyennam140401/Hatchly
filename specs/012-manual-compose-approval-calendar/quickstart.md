# Quickstart – kiểm chứng 012 đầu–cuối

Mục tiêu: chứng minh luồng *soạn → gửi duyệt → duyệt → lên lịch → đổi giờ → sửa → duyệt lại* chạy với bản giả lập, không cần nền tảng thật.
Chi tiết điểm cuối: [contracts/http-api.md](contracts/http-api.md); bảng: [data-model.md](data-model.md).

## Chuẩn bị

```powershell
Copy-Item apps/server/.env.example apps/server/.env     # nếu chưa có
# trong .env: PLATFORM_DRIVER=fake  PUBLISH_EXECUTOR=fake  MAIL_TRANSPORT=memory
pnpm db:up
pnpm db:setup            # vai trò + migration (có 0017, 0018 hoặc số sau khi đánh lại)
pnpm db:check            # → ĐẠT: 0 vi phạm
pnpm dev:seed-auth       # chủ A + cộng tác viên + tài khoản B (kiểm truy cập chéo)
pnpm dev                 # api + worker (+ web nếu 011 đã có)
```

Seed cần: tài khoản A có chủ `owner`, cộng tác viên `minh`, **2 kênh giả lập** đang hoạt động (Facebook Page, Instagram); tài khoản B có 1 kênh.

## Kịch bản

**A – Soạn nháp (US1).** `POST /posts` với 2 kênh, `sharedText` + riêng Instagram thêm 3 hashtag, không media. `GET /posts/:id` → `status=draft`,
Instagram `issues` có `media_required`; lưu được, **không** gửi duyệt/duyệt được (`POST_CONTENT_INVALID`). Thêm media giả → hết lỗi. Tài khoản B `GET` cùng id → 404.

**B – Duyệt một bài (US2).** Với chủ: `POST /posts/:id/approve {expectedVersion, scheduledAt = now+30'}` → `approved`; đúng 2 dòng `publish_attempts`
(`scheduled`) và 2 việc `publish`. Gọi lại cùng yêu cầu 20 lần song song → 1 thành công, còn lại `POST_ALREADY_APPROVED`; vẫn đúng 2 mục/2 việc.
Giờ `now+2'` → `TIME_IN_PAST` kèm `suggestedAt`. Cộng tác viên gọi `approve` → 403.

**C – Tất cả hoặc không (US2-3,4).** Dùng điều khiển giả lập đặt Instagram `expired`; duyệt lại bài khác → `CHANNEL_INACTIVE`, **không** mục nào được tạo
(kể cả kênh Facebook). Bỏ kênh Instagram khỏi bài bằng `PUT /posts/:id` (bỏ phần tử Instagram trong `variants`) → duyệt lại → thành công với 1 kênh. Đặt `max_posts_per_24h = 1` rồi duyệt hai bài cùng giờ → bài thứ hai `CHANNEL_QUOTA_EXCEEDED`.

**D – Chờ duyệt và hàng loạt (US3, US4).** `minh` soạn 3 bài và `POST /posts/submit` → `submitted:3`; kiểm tra `MAIL_TRANSPORT=memory`: **một** email, **một** thông báo
cho chủ. Chủ `GET /approvals/pending` → 3 bài sắp theo giờ gần nhất; một bài có giờ đã qua → `timePassed=true`. `POST /approvals/suggest-times {count:1}` → giờ gợi ý;
`POST /approvals/approve-batch` với 2 bài hợp lệ + 1 bài giờ quá khứ không kèm `scheduledAt` → `approved:2, failed:1 (TIME_IN_PAST)`. `return` bài còn lại với ghi chú "Giá chưa đúng"
→ `minh` thấy `returnedNote`, có thông báo in-app, **không** email.

**E – Sửa sau duyệt (US6).** `minh` `PUT /posts/:id` sửa 1 chữ ở Facebook của bài `approved` → bài `pending_review` + nhãn `editedAfterApproval`, các mục `cancelled`,
việc `publish` bị hủy, chủ nhận `post_pending_review`. Chủ duyệt lại → mục mới (`scheduled`), không còn mục cũ đang hiệu lực. Lặp với đổi media/thêm kênh/bớt kênh.

**F – Đổi giờ và Lịch (US5).** `GET /calendar?from&to` → thấy đúng bài, đúng giờ UTC (web hiển thị UTC+7). `PUT /posts/:id/schedule` ngày mai → thành công, `status` vẫn `approved`, việc đổi
`runAfter`; giờ quá khứ → `TIME_IN_PAST`; `minh` đổi giờ → chủ nhận `approved_post_rescheduled` (in-app). Hai yêu cầu cùng `expectedVersion` → một thành công, một `VERSION_CONFLICT`.

**G – Thực thi tạm (R10).** Với `PUBLISH_EXECUTOR=fake` chờ tới giờ → mục `succeeded`, Lịch hiện "Đã đăng"; hủy một bài trước giờ → mục `cancelled`, bài không đăng. Đặt `PUBLISH_EXECUTOR=none`
→ việc bị hoãn 15 phút, mục vẫn `scheduled`, không mất.

**H – Khóa AI không cản (US1-5, SC-011).** Đặt ngân sách AI của A về hết → kịch bản A–F vẫn chạy y như cũ.

## Kiểm thử tự động tương ứng

```powershell
pnpm test              # đơn vị: quy tắc kiểm tra kênh, gợi ý giờ, bảng chuyển trạng thái, khuôn Zod
pnpm test:db           # truy cập chéo 4 bảng, đồng thời duyệt, hoàn tác trọn gói, hạn mức Instagram, chạy lại hai lần
pnpm check:boundaries  # ranh giới module (sau khi thêm content → platform_gateway)
pnpm db:check; pnpm db:lint-migrations
pnpm --filter web test # Soạn, Chờ duyệt, Lịch (vitest-axe), 360 px, vùng chạm ≥ 44 px
```

Đạt khi: cả 8 kịch bản đúng như mô tả, `pnpm test:db` xanh (không rò rỉ chéo tài khoản, không mục trùng, không đăng nội dung chưa duyệt) và các số SC-003, SC-004, SC-006, SC-009 đạt trong kiểm thử tự động.
