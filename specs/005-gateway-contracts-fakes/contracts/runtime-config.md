# Hợp đồng – Chọn bản cài đặt, chặn môi trường chính thức, quản trị giả lập

## 1. Biến môi trường (thêm vào `AppConfigSchema`, đọc bởi cả API và Worker)

| Biến | Giá trị cho phép | Bắt buộc | Ghi chú |
|---|---|---|---|
| `PLATFORM_GATEWAY_DRIVER` | `fake` | có | WBS 2.3 thêm `real` |
| `AI_GATEWAY_DRIVER` | `fake` | có | WBS 3.1 thêm `real` |
| `NOTIFICATIONS_DRIVER` | `fake` | có | WBS 4.3 thêm `real` |
| `STORAGE_DRIVER` | `memory` \| `s3` | có | |
| `MAIL_TRANSPORT` | `memory` \| `smtp` | có (nay cả Worker) | có từ 004, chuyển khỏi `AuthConfig` |
| `FAKE_STATE_STORE` | `memory` \| `sandbox` | khi có driver `fake` | `memory` ở API+Worker riêng tiến trình → trạng thái không chung (chỉ hợp cho kiểm thử) |
| `S3_ENDPOINT` | URL | khi `s3` | MinIO dev: `http://minio:9000` |
| `S3_PUBLIC_ENDPOINT` | URL | không | địa chỉ ký đường dẫn cho trình duyệt/nền tảng; mặc định = `S3_ENDPOINT` |
| `S3_REGION`, `S3_BUCKET` | chuỗi | khi `s3` | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | chuỗi (**bí mật**) | khi `s3` | |
| `S3_FORCE_PATH_STYLE` | `true` \| `false` | không | `true` cho MinIO |
| `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` | số nguyên ≥ 0 | không | mặc định 2 000 000 |
| `PLATFORM_SUBMIT_TIMEOUT_MS` | 5 000–120 000 | không | mặc định 30 000 |
| `AI_PROVIDER_TIMEOUT_MS`, `AI_FIRST_TOKEN_TIMEOUT_MS` | số | không | 40 000 / 5 000 |

## 2. Quy tắc khởi động

- `APP_ENV ∈ {staging, production}` và có **bất kỳ** `*_DRIVER=fake`, `STORAGE_DRIVER=memory`,
  `MAIL_TRANSPORT=memory`, hoặc `FAKE_STATE_STORE` được đặt → `ConfigError` liệt kê đủ các thành phần vi phạm,
  ví dụ:
  `Môi trường production không được dùng bản giả lập: PLATFORM_GATEWAY_DRIVER=fake, AI_GATEWAY_DRIVER=fake` – tiến
  trình thoát mã 1 (API và Worker như nhau – SC-006).
- `FAKE_STATE_STORE=sandbox` mà chưa có schema `sandbox` → dừng: "Chưa có schema sandbox – chạy `pnpm db:setup`".
- Khởi động thành công ghi một dòng `gateways.selected` (cả hai đơn vị) với lựa chọn từng thành phần.

## 3. Endpoint quản trị giả lập (chỉ `APP_ENV ∈ {development, test}`)

Đăng ký có điều kiện trong `ApiAppModule` (như `DiagnosticsController`). Môi trường khác: không có route → `404`.
Mọi route gắn tài khoản trong phiên (`@CustomerAccess('status.view')`); không nhận mã tài khoản.

| Route | Vào | Ra |
|---|---|---|
| `GET /dev/fakes/scenarios` | – | `200 FakeScenario[]` của tài khoản |
| `PUT /dev/fakes/scenarios` | `{ component: 'platform'\|'ai'\|'notifications'\|'mail', target: string, spec: object, remainingUses?: number }` | `200 FakeScenario` (Zod theo `component`) |
| `DELETE /dev/fakes/scenarios/:id` | – | `204` |
| `DELETE /dev/fakes/scenarios` | – | `204` (xóa hết của tài khoản) |
| `GET /dev/fakes/platform/posts` | – | `200` bài giả đã lên + `publishedCount` theo dấu |
| `GET /dev/fakes/ai/budget` | – | `200` ngân sách giả (có số tiền – chỉ dev) |
| `PUT /dev/fakes/ai/budget` | `{ used?, reserved?, cycleStart? }` | `200` |
| `POST /dev/fakes/ai/generate` | `{ task, delta }` | `200 AiResult` – gọi `AiGatewayPublicApi.generate` thật sự (đi đủ trình tự) |
| `POST /dev/fakes/storage/upload-url` | `{ contentType, maxBytes }` | `200 PresignedUpload` cho `media_original` với `mediaId` mới |
| `GET /dev/fakes/notifications` | – | `200` thông báo đã ghi |
| `GET /dev/fake-oauth/:channelType/authorize` | `state`, `redirect_uri` | HTML trang ủy quyền giả |

`spec` theo `component` dùng cùng khuôn `FakeStep` của API lập trình (contracts/platform-gateway.md mục 4,
ai-gateway.md mục 4). Kịch bản có `remainingUses` giảm dần bằng cập nhật có điều kiện, hết thì tự bỏ.

## 4. Docker compose (dev)

- Thêm dịch vụ `minio` (ảnh khóa tag phát hành; cổng `9000`, console `9001`; người dùng/mật khẩu `*_dev_only`) và
  dịch vụ một lần `minio-init` tạo bucket `app-dev`, CORS cho `http://localhost:8080,http://localhost:5173`, luật
  vòng đời lọc theo nhãn đối tượng `lifecycle=tmp` hết hạn 1 ngày (tệp tạm nằm ở `tenants/{acc}/tmp/{jobId}/…`).
- `x-server-env` thêm: `PLATFORM_GATEWAY_DRIVER=fake`, `AI_GATEWAY_DRIVER=fake`, `NOTIFICATIONS_DRIVER=fake`,
  `STORAGE_DRIVER=s3`, `FAKE_STATE_STORE=sandbox`, `S3_*` trỏ MinIO; `S3_PUBLIC_ENDPOINT=http://localhost:9000`.
- Worker thêm `depends_on: mailpit, minio-init`.
- Ghi chú đầu tệp: MinIO và Mailpit **chỉ** dev; không có trong hạ tầng thật.
