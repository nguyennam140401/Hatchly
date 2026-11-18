# Quickstart – kiểm chứng 010 từ đầu đến cuối

Mục đích: chứng minh tính năng chạy được **mà không cần Meta/TikTok thật** (bản giả + máy chủ Graph/TikTok giả), rồi nêu cách thử với môi trường thật khi có.
Đây là hướng dẫn chạy/kiểm chứng; mã, migration, bộ kiểm thử đầy đủ nằm ở `tasks.md` và giai đoạn implement. Lệnh PowerShell (Windows). Chi tiết cổng chất lượng: `docs/wiki/howto/run-tests.md`.

## 0. Chuẩn bị

```powershell
# Từ worktree của tính năng (sau khi /speckit-worktree-sync đã merge dev)
pnpm install
Copy-Item apps/server/.env.example apps/server/.env   # nếu chưa có
pnpm db:up; pnpm db:setup
# Biến dùng cho 010 (dev): bản giả + khóa giả
#   PLATFORM_GATEWAY_DRIVER=fake  FAKE_STATE_STORE=sandbox  CREDENTIAL_VAULT_DRIVER=fake
```

Bảng cần có sau `pnpm db:migrate`: `platform_gateway.channel_connections`, `connect_states`, `connect_selections`, `feature_overrides`, `feature_override_events`, `gateway_settings`.

## 1. Cổng tự động (không cần mạng ngoài)

| Mục tiêu | Lệnh | Kỳ vọng |
|---|---|---|
| Kiểu, lint, ranh giới module, quét bí mật | `pnpm typecheck; pnpm lint; pnpm check:boundaries; pnpm check:secrets` | xanh; `platform_gateway → account` đã khai báo; không import chéo `publishing` |
| Hợp đồng bộ chuyển đổi (Facebook, Instagram, TikTok, giả) | `pnpm --filter @app/server test -- platform-gateway/adapter-contract` | mọi ca xanh; **0 lời gọi mạng** TikTok khi công tắc tắt |
| Đơn vị: `deriveState`, `toLegacyStatus`, `resolveFlag`, vault phong bì | `pnpm --filter @app/server test -- platform-gateway` | bảng ánh xạ + bất biến "dùng được ⇔ active\|expiring" |
| CSDL: RLS, truy cập chéo, chỉ mục duy nhất, đua | `pnpm db:check; pnpm test:db` | A không đọc/sửa/xóa/đoán mã của B; hai `confirm` cùng Page ⇒ 1 kết nối; chọn quá giới hạn song song ⇒ từ chối |
| Việc nền: chạy lại hai lần, hai Worker, Worker chết | `pnpm test:queue` | cùng kết quả, đúng 1 thông báo/mốc, không ghi đè quyền mới |
| Tương thích CSDL bản cũ/mới | `pnpm test:compat; pnpm db:lint-migrations` | migration chỉ thêm |
| Web: màn hình + trợ năng + ma trận quyền | `pnpm --filter @app/web test; pnpm test:web-e2e` | 360/768/1280 px không cuộn ngang, axe sạch, TikTok vô hình khi tắt |
| Tất cả như CI | `pnpm verify` | xanh |

## 2. Kịch bản thủ công với bản giả (chạy được trên máy dev)

Chạy `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`; tạo tài khoản mẫu `pnpm dev:seed-auth`; đăng nhập chủ, mở **/channels** (360 px bằng DevTools).

| # | Việc làm | Kết quả mong đợi (liên kết spec) |
|---|---|---|
| 1 | Tài khoản mới mở /channels | Trạng thái trống + "chỉ đăng khi bạn bấm Duyệt"; **không** có chữ TikTok (US6-1, US9-1) |
| 2 | "Kết nối Facebook Page" → kịch bản giả "2 Page" → chọn cả hai → xác nhận | 2 thẻ "Đang hoạt động", có ngày hết hạn, nhóm "Facebook Page (2/5)"; phản hồi/log/DB không có chuỗi `fake_tok_` ở dạng rõ (US1, US8, US4) |
| 3 | "Kết nối Instagram" với IG cá nhân → rồi IG chuyên nghiệp | Cá nhân: hướng dẫn + "Kiểm tra lại", không tạo kênh; chuyên nghiệp: thẻ `@…` liên kết Page nguồn (US2) |
| 4 | Dùng kịch bản "thiếu quyền" / "vai trò thấp" | mỗi ca một thông điệp đời thường + ≥ 1 hành động; không có mã lỗi gốc ngoài "Chi tiết cho hỗ trợ" (US3) |
| 5 | Đặt đồng hồ giả: kết nối hết hạn sau 10 ngày → chạy việc hằng ngày; rồi kịch bản "làm mới lỗi" khi còn 6 ngày | lần 1 hạn lùi ra, không thông báo; lần 2 "Sắp hết hạn", đúng 1 thông báo + 1 email; còn 1 ngày thêm 1; hết hạn ⇒ "Cần kết nối lại" (US5) |
| 6 | Kết nối lại cùng Page, rồi thử Page khác | cùng `connectionId`, bài đã lên lịch nguyên vẹn; Page khác ⇒ "Đây là Page khác…" (US7, SC-008) |
| 7 | Ngắt Page A có Instagram liên kết | hộp xác nhận nêu số bài + "Instagram @… sẽ cần kết nối lại"; sau ngắt: mã quyền biến mất khỏi DB; IG ⇒ "Cần kết nối lại" (US8-8, FR-042) |
| 8 | Đăng nhập cộng tác viên | thấy mọi thẻ/hạn, **không** có nút thao tác; gọi `POST /api/v1/channels/connect` ⇒ 403 (US6-5, FR-027) |
| 9 | Công tắc TikTok: `pnpm staff feature set <accountId> --value on --reason "thử nghiệm"` | ≤ 1 phút chủ thấy "Kết nối TikTok" + "TikTok chỉ đăng video" + "đang thử nghiệm"; khách khác không thấy; tắt lại ⇒ kết nối thành "Tạm tắt", ngắt được (US9) |
| 10 | Hết hạn gói (đặt gói quá hạn bằng `account` seed) | chặn kết nối mới ("Gói đã hết hạn"), vẫn xem/ngắt; việc hằng ngày không gọi nền tảng (US7-6) |

## 3. Kiểm chứng an toàn bí mật (SC-003, SC-009)

```powershell
pnpm check:secrets                                       # quét mã nguồn + nhật ký mẫu
pnpm --filter @app/server test -- platform-gateway/secret-scan   # quét phản hồi, log, thông báo, email, URL gọi ra bằng mẫu EAA…, act.…, fake_tok_*, client_secret
# Đọc thô bảng (chỉ trong test:db): token_ciphertext không giải mã được nếu thiếu khóa KMS/khóa chủ; ngắt ⇒ cột = NULL cùng giao dịch
```

## 4. Với môi trường thật (khi có K5/App Review/TikTok) – **không** thuộc cổng CI

1. Cấu hình `PLATFORM_ADAPTER_MODE=real`, `CREDENTIAL_VAULT_DRIVER=kms` (production) hoặc `env-master-key` (staging có `STAGING_ALLOW_ENV_MASTER_KEY=true`), `FACEBOOK_APP_ID/SECRET`, `CHANNEL_CONNECT_REDIRECT_BASE`, quyền `CHANNEL_SCOPES_*`.
2. Thêm tài khoản thử nghiệm vào ứng dụng Meta (chưa duyệt: chỉ họ kết nối được; người khác thấy "Tính năng kết nối đang được chuẩn bị").
3. Quay video luồng: cấp quyền → chọn Page → điều kiện tài khoản → ngắt/thu hồi (SC-010, hồ sơ nộp xét duyệt Meta cùng 013).
4. Ghi lại dữ kiện thật vào [research.md](./research.md) R1/R2 (hạn token Page, `data_access_expires_at`, quyền tối thiểu) rồi chỉnh cấu hình; cập nhật POC-2.

## 5. Tiêu chí "xong" (đối chiếu spec)

SC-001…SC-013 đạt theo mục 1–3; cổng `pnpm verify --ci` xanh; `modules.manifest.json` + ADR-13 + `docs/wiki` (qua `/speckit-wiki-ingest`) + đặc tả yêu cầu (ghi chú TikTok giai đoạn 1, mã quyền mới `channel.view`/`feature.manage`) được cập nhật.
