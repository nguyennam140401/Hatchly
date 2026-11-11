# Quickstart – kiểm chứng 005

Hướng dẫn chạy để chứng minh tính năng hoạt động. Chi tiết hợp đồng: [contracts/](contracts/); thực thể:
[data-model.md](data-model.md).

## 0. Chuẩn bị

```bash
git merge dev                      # nhánh impl/005 phải có 003 + 004 (xem research.md)
pnpm install
docker compose up -d postgres mailpit minio minio-init
pnpm db:setup                      # vai trò + migration chính + migration dev (schema sandbox)
cp apps/server/.env.example apps/server/.env   # đã có các biến *_DRIVER=fake, STORAGE_DRIVER=s3, FAKE_STATE_STORE=sandbox
```
Không chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080, nay thêm 9000/9001).

## 1. Bộ kiểm thử hợp đồng với bản giả lập (SC-001…SC-004, SC-008)

```bash
pnpm --filter @app/server test -- test/contracts        # chế độ bộ nhớ, không cần Docker
```
Kỳ vọng: mọi bộ `describe*Contract` qua; tổng thời gian ≤ 2 phút. Kiểm có:
- `platform`: 8 kịch bản US1 cho Facebook/Instagram/Zalo + kênh `test_channel` (US2), `publishedCount` đúng.
- `ai`: kiểm đồng thời 100 × 25 lời gọi, 0 lần vượt trần, 0 giữ chỗ treo.
- `notifications`: mọi loại trong danh mục, khóa chống trùng, trường bị cấm – dùng `memoryTx()` + hàng chờ trong bộ nhớ,
  harness `flush()` chạy bộ xử lý (research R9b). Ca "giao dịch hủy" chỉ chạy ở mục 2.
- `storage` (memory): ma trận truy cập chéo; tệp tạm ở `tenants/<acc>/tmp/<jobId>/`.

## 2. Chế độ `sandbox` (CSDL thật)

```bash
pnpm test:db -- test/contracts
```
Kỳ vọng: cùng bộ hợp đồng qua với kho `sandbox`; thêm: giao dịch hủy sau `emit` → 0 thông báo; `emit` lỗi trong
giao dịch quyết toán AI → 0 cờ, 0 sổ, 0 sự kiện; `reserve` p95 ≤ 50 ms; truy cập chéo trên mọi bảng `sandbox.*_fake_*`;
`pnpm db:check` sạch.

## 3. Bản thật S3 + SMTP trên dịch vụ cục bộ (FR-054, FR-055)

```bash
pnpm --filter @app/server test:infra      # cần minio + mailpit đang chạy
```
Kỳ vọng: `describeObjectStorageContract` qua với MinIO (POST policy chặn quá cỡ/sai loại/sai khóa/hết hạn);
`describeMailerContract` qua với Mailpit (thư đọc lại qua `http://localhost:8025/api/v1/messages`).

## 4. Chạy cả ứng dụng bằng bản giả lập (US6, SC-007, SC-011)

```bash
docker compose up --build -d
docker compose logs api worker | grep gateways.selected
# → cả hai: {"platform":"fake","ai":"fake","notifications":"fake","storage":"s3","mail":"smtp","fakeState":"sandbox"}
pnpm dev:seed-auth                         # tài khoản chủ mẫu
```
Luồng thử (đăng nhập ở http://localhost:8080 rồi gọi API bằng cookie phiên, hoặc chạy
`pnpm --filter @app/server test:e2e-fakes` tự động hóa đúng các bước):
1. `POST /api/channels/connect {channelType:"facebook_page"}` → mở `authorizeUrl` (trang ủy quyền giả) → "Đồng ý"
   → chọn Page → `POST /api/channels` → `GET /api/channels` có kết nối, **không** có trường mã quyền.
2. Đặt kịch bản `PUT /dev/fakes/scenarios {component:"platform", target:"connection:<id>",
   spec:{steps:[{submit:"timeout_after_publish"}]}}`; chạy luồng gửi mẫu (kiểm thử e2e) → `submit` = `unknown`,
   `reconcile` = `found`, `GET /dev/fakes/platform/posts` → `publishedCount = 1`.
3. `POST /dev/fakes/ai/generate {task:"post_generation", delta:"..."}` → `GET /dev/fakes/ai/budget` thấy `used` tăng;
   `PUT /dev/fakes/ai/budget {used:3999000}` → lời gọi tiếp bị chặn "Đã sử dụng hết giới hạn AI của chu kỳ".
4. Vượt 80% → Mailpit (http://localhost:8025) có thư "Mức sử dụng AI 80%" trong ≤ 10 giây; thư không có số tiền.
5. `POST /dev/fakes/storage/upload-url {contentType:"image/png", maxBytes:5000000}`, tải từ trình duyệt/`curl -F` → MinIO console
   (http://localhost:9001) thấy `tenants/<accountId>/media/<mediaId>/original` trong ≤ 10 giây.

Kiểm "0 kết nối mạng ra ngoài": chạy e2e với `NODE_OPTIONS=--require ./test/helpers/deny-egress.cjs` (chặn mọi
socket tới máy ngoài `localhost`/dịch vụ compose) → không lỗi.

## 5. Chặn ở môi trường chính thức (US6-AS2, SC-006, FR-006)

```bash
pnpm --filter @app/server test -- test/unit/gateway-selection
```
Kỳ vọng: với `APP_ENV=production|staging`, mỗi tổ hợp có ≥ 1 thành phần giả → `ConfigError` nêu đúng tên biến;
`shouldRegisterDevRoutes('production'|'staging') = false`; `ApiAppModule` dựng với cấu hình tiêm trực tiếp
`appEnv='production'` (bỏ qua `loadConfig`, provider thay bằng bản rỗng) → `GET /dev/fakes/scenarios` = 404.

## 6. Ranh giới và quét bí mật

```bash
pnpm check:boundaries     # quy tắc mới: core/storage, enqueueRegistered, src/dev, @aws-sdk/*
pnpm verify               # typecheck + lint + boundaries + scan-secrets (nhật ký mẫu của bộ hợp đồng)
```
Kỳ vọng: sạch; fixture vi phạm mới trong `tooling/boundaries/fixtures/` đều bị bắt; nhật ký mẫu không có
`fake_tok_`, `PROMPT_CANARY_`, `POST_CANARY_` (SC-009).
