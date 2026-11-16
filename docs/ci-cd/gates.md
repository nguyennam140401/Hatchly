# Cổng chất lượng (`pnpm verify`)

`pnpm verify` là **nguồn duy nhất** của các cổng: máy cá nhân và Jenkins chạy cùng một danh sách và cho cùng kết quả
trên cùng commit (SC-012). Jenkins không viết kiểm tra nào trong Groovy; nó chạy `pnpm verify --ci --only <bước>` theo
từng làn ([ops/ci/gate-lanes.json](../../ops/ci/gate-lanes.json)).

```powershell
pnpm verify                                    # mọi bước, chế độ máy cá nhân (bước thiếu điều kiện → bỏ qua có thông báo)
pnpm verify --ci --report verify-report.json   # đúng lệnh Jenkins chạy: KHÔNG có "bỏ qua" – thiếu điều kiện = không đạt
pnpm verify --only test:db,lint                # chỉ vài bước (tên sai → in danh sách tên hợp lệ)
```

Trạng thái mỗi bước: `passed` ✓ · `failed` ✗ · `skipped` (chỉ máy cá nhân; trên CI tính là **không đạt** – FR-008) ·
`excepted` `!` (có ngoại lệ còn hạn) · `not_applicable` `·` (bước tự báo không áp dụng kèm lý do).

## Danh sách cổng

| Cổng                      | Làn    | Kiểm tra gì                                                                                                    | Cần                                          | Ngoại lệ  |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------- |
| `build:shared`            | static | dựng gói `@app/shared`                                                                                         | —                                            | có        |
| `typecheck`               | static | kiểu TypeScript nghiêm ngặt mọi gói                                                                            | —                                            | có        |
| `lint`                    | static | ESLint                                                                                                         | —                                            | có        |
| `check:boundaries`        | static | ranh giới module (không import nội bộ, không SQL sang schema khác)                                             | —                                            | có        |
| `check:web-rules`         | static | giao diện: không màu/cỡ chữ/khoảng cách viết cứng, không định dạng tiền ở khu vực khách hàng (011)             | —                                            | có        |
| `check:secrets`           | static | quét bí mật trong mã, `ops/**`, `infra/ci/**`, `.github/**`, `Jenkinsfile*`, `Dockerfile*`                     | —                                            | **không** |
| `check:pipeline`          | static | định nghĩa quy trình: ảnh theo digest, `plugins.txt`, lược đồ môi trường, làn, ruleset, chart Helm, ngoại lệ   | helm (bắt buộc trên CI)                      | có        |
| `check:release-source`    | static | nguồn phát hành hợp lệ (chỉ khi đích là `master`; xem [branching-and-release.md](branching-and-release.md))    | biến `GATE_*`, `STAGING_DEPLOYED_SHA`        | **không** |
| `test`                    | static | kiểm thử đơn vị                                                                                                | —                                            | có        |
| `check:web-bundle`        | static | gói web không chứa thứ cấm                                                                                     | —                                            | có        |
| `db:lint-migrations`      | static | migration mới tương thích ngược (xem [backward-compatible-migrations.md](backward-compatible-migrations.md))   | `MIGRATION_BASE_REF`                         | có        |
| `db:immutable`            | static | migration đã có ở nhánh gốc không bị sửa; mốc `when` tăng dần                                                  | `MIGRATION_BASE_REF`                         | **không** |
| `test:db`                 | db     | CSDL thật: RLS, kiểm thử truy cập chéo mọi bảng khách hàng (kèm "đã phủ N / tổng M bảng"), quyền vai trò       | `TEST_DATABASE_ADMIN_URL`                    | **không** |
| `test:queue`              | db     | hàng chờ pg-boss thật: không đăng trùng, chạy lại an toàn, loại việc lạ                                        | `TEST_DATABASE_ADMIN_URL`                    | có        |
| `db:compat`               | db     | bản **đang chạy** ở môi trường vẫn chạy được trên cấu trúc mới (`pnpm test:compat` của bản đó)                 | `TEST_DATABASE_ADMIN_URL`, `COMPAT_BASE_SHA` | có        |
| `check:secrets:test-logs` | db     | quét bí mật trong nhật ký mẫu của kiểm thử                                                                     | chạy sau `test:db`                           | **không** |
| `test:e2e`                | e2e    | kiểm thử end-to-end trên API + web thật                                                                        | `TEST_DATABASE_ADMIN_URL`, trình duyệt       | có        |
| `test:web-e2e`            | e2e    | giao diện trên trình duyệt: danh mục ở 360/768/1280 px (axe 0 lỗi nghiêm trọng), khung theo vai trò, hết phiên | trình duyệt Chromium (thiếu → bỏ qua)        | có        |
| `check:image`             | image  | dựng ảnh, kiểm nội dung, chạy `migrate → api → worker`, phiên bản = SHA                                        | docker, `TEST_DATABASE_ADMIN_URL`            | có        |

**Không cho ngoại lệ**: `test:db` (gồm cô lập tenant), `check:secrets`, `check:secrets:test-logs`, `db:immutable`,
`check:release-source` – đều là cổng an toàn dữ liệu / quy trình (hiến pháp nguyên tắc I, VII). `check:pipeline` báo lỗi
nếu có tệp ngoại lệ cho các cổng này.

## Đọc kết quả trên pull request

- **`ci/gates`**: kiểm tra duy nhất bắt buộc; xanh khi mọi cổng `passed`/`excepted`/`not_applicable`. Phần tóm tắt là
  bảng tổng kết.
- **`gate/<bước>`**: mỗi bước một kiểm tra. Không đạt hiện đủ bốn thứ: tên cổng · dòng lỗi đầu tiên · đường dẫn
  nhật ký đầy đủ trên Jenkins · lệnh chạy lại (`pnpm verify --only <bước>`).
- Cổng có ngoại lệ hiện kết luận `neutral` với tiêu đề "VƯỢT CỔNG (ngoại lệ) – duyệt bởi …".
- Không có tự chạy lại khi đỏ: bấm **Re-run** trên GitHub hoặc Replay/Rebuild trên Jenkins.

## Hợp đồng `pnpm test:compat` (mọi phiên bản từ 008 trở đi)

`db:compat` dựng mã của bản **đang chạy** ở môi trường (trong thư mục `.compat-base/`, luôn dọn xong), chuẩn bị một CSDL
tạm với migration của bản **mới**, rồi chạy `pnpm test:compat` của bản cũ trên đó. Bản cũ MUST:

- đọc 4 biến `COMPAT_DATABASE_{OWNER,APP,SYSTEM,SUPPORT}_URL` (CSDL đã migrate – **không** tự migrate, không xóa schema);
- khởi động `api` và `worker` của chính nó, chờ `/healthz`, `/readyz`, chạy kiểm thử **hành vi** và một vòng tạo việc → xử lý;
- không chứa kiểm thử khẳng định cấu trúc (số migration, quy ước bảng, danh sách schema);
- thoát `0` = chạy được trên cấu trúc mới.

Chưa có bản đang chạy hoặc bản đó trước 008 (chưa có kịch bản này) → `not_applicable` kèm lý do.

> **Rủi ro R-10**: tập kiểm thử hành vi nhỏ thì `db:compat` chỉ chứng minh những gì nó thử. Khi thêm tính năng đọc/ghi
> bảng mới ở đường chính, thêm ca tương ứng vào `apps/server/test/compat/` (vòng đời "bản cũ đọc/ghi được bảng này").
