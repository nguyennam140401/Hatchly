# Quickstart: kiểm chứng Thư viện media cơ bản (014)

Hướng dẫn **chạy kiểm chứng** từ đầu đến cuối; không chứa mã triển khai. Hợp đồng: [contracts/](./contracts/) · Dữ liệu: [data-model.md](./data-model.md) · Quyết định: [research.md](./research.md).
Chạy trong worktree `impl/014-media-library-basic` (mỗi worktree có `.env` riêng; không chạy docker compose ở hai checkout cùng lúc – trùng cổng 3000/3001/8080).

## 0. Điều kiện

```bash
pnpm install
pnpm db:up                       # PostgreSQL + Mailpit
docker compose up -d minio minio-init   # kho tệp dev (MinIO, S3): API :9000, console :9001
pnpm db:setup                    # tạo vai trò + migrate (gồm migration media của tính năng này)
pnpm build:shared
```

Kiểm tra công cụ xử lý (Worker): `ffprobe -version` và `ffmpeg -version` chạy được (dev: cài vào máy hoặc chạy qua ảnh `app-server:local` đã có `ffmpeg`).

## 1. Kiểm tra tự động (chạy theo nhóm, mọi nhóm phải xanh trước khi merge)

| Nhóm | Lệnh | Bao phủ |
|---|---|---|
| Đơn vị (thuần) | `pnpm --filter @app/server test` | `sniffMedia` (bảng tệp giả: `.jpg` chứa HTML/EXE/SVG/GIF/WebP động…), tính phần/`partCount`, chuẩn hóa tên hiển thị, ánh xạ lỗi, ánh xạ quyền xóa của cộng tác viên |
| Kho tệp – hợp đồng | `pnpm --filter @app/server test` (`memory`) rồi `pnpm test:infra` (`s3`→MinIO) | 9 mục của [storage-multipart.md](./contracts/storage-multipart.md) §4 (tiếp tục tải, hết hạn, truy cập chéo) |
| CSDL + RLS | `pnpm test:db` | `media.media`, `upload_sessions`, `storage_quotas`: cô lập tenant (A không đọc/sửa/xóa của B), CHECK, chỉ mục duy nhất, **đồng thời** (≥ 20 yêu cầu song song không vượt 5 GB – SC-005), hoàn dung lượng (SC-009), hàm `list_cleanup_accounts` chỉ trả mã tài khoản |
| API (e2e) | `pnpm --filter @app/server test` (`media/*.e2e.spec.ts`) | ma trận quyền × 4 vai trò, mọi mã lỗi ở [media-http-api.md](./contracts/media-http-api.md), `complete` gọi lặp, hết gói ⇒ tải bị chặn nhưng xem/xóa được, không URL `public` trong phản hồi |
| Hàng chờ + Worker | `pnpm test:queue` | `media.process` ảnh/video thật (tệp mẫu nhỏ trong `test/fixtures/media/`), chạy lại hai lần (`expectIdempotent`), hai Worker cùng lấy một việc, đường trùng, `unprocessable`, `media.cleanup` (phiên quá hạn, tệp mồ côi, đối soát bộ đếm) |
| Hợp đồng `MediaPublicApi` | `pnpm test:db` | `describe`/`assertAttachable`/`issuePublicUrl` + nhà cung cấp "bài dùng media" giả (R10) |
| Ranh giới/CI | `pnpm check:boundaries && pnpm db:check && pnpm db:lint-migrations && pnpm typecheck && pnpm lint` | không import chéo module, bảng có `account_id` đều bật RLS, migration chỉ thêm |
| Giao diện | `pnpm --filter @app/web test` | hàng đợi tải (trạng thái mới, nhận lại phiên, mất mạng), `QuotaMeter`, hộp xóa, lưới, axe |
| Trình duyệt | `pnpm test:web-e2e` (hoặc `pnpm test:e2e`) | Playwright 360 px: tải ảnh → "Sẵn sàng"; chọn lại video đang dở → tiếp tục |
| Tất cả | `pnpm verify` | cổng chất lượng đầy đủ |

## 2. Thử bằng tay (dev)

```bash
pnpm dev:seed-auth       # tài khoản mẫu: chủ + cộng tác viên
pnpm dev:api             # terminal 1
pnpm dev:worker          # terminal 2
pnpm dev:web             # terminal 3  → http://localhost:3000/media
```

| # | Thao tác | Kết quả đúng |
|---|---|---|
| 1 | Đăng nhập chủ → mở **Thư viện**; kéo thả 5 ảnh JPEG + 1 video ~200 MB | 6 dòng tiến độ riêng; ≤ 3 tệp tải cùng lúc; xong → "Sẵn sàng", lưới có ảnh thu nhỏ; "Đã dùng" tăng đúng tổng dung lượng (US1) |
| 2 | Chọn 1 tệp `.exe` đổi đuôi `.jpg`, 1 ảnh > 20 MB, 1 video > 500 MB cùng lúc với tệp hợp lệ | Từng tệp lỗi bị từ chối **trước khi tải** với lý do + cách khắc phục; tệp hợp lệ vẫn tải (FR-003) |
| 3 | Tải video 300 MB; tắt mạng (DevTools → Offline) khi ~50%; bật lại | "Tạm dừng – đang chờ mạng" rồi tự tiếp tục, **không** gửi lại phần đã lên (xem Network: chỉ các phần còn thiếu) (US2, SC-002) |
| 4 | Tải video dở rồi đóng tab; mở lại, chọn lại **đúng** tệp | Tiến độ bắt đầu từ phần đã có; hoàn tất (US2 kịch bản 2) |
| 5 | Chọn lại tệp dở **sau 24 giờ** (đổi giờ hệ thống hoặc đặt `sessionTtlSec` nhỏ ở môi trường dev) | "Lần tải trước đã hết hạn, đang tải lại từ đầu"; phiên cũ được dọn, giữ chỗ trả lại (US2 kịch bản 3) |
| 6 | Tải ảnh PNG, ảnh HEIC iPhone, ảnh JPEG có thông tin xoay | Mỗi ảnh có bản JPEG chuẩn (cạnh dài ≤ 2048 px) và ảnh thu nhỏ **đúng chiều**; gốc còn nguyên; không có vị trí GPS trong bản chuẩn (US3, SC-004) |
| 7 | Đặt tài khoản gần đầy (dev: đặt `MEDIA_QUOTA_BYTES` nhỏ, ví dụ 100 MB, trong `apps/server/.env`, khởi động lại API, dùng tài khoản mới vì `limit_bytes` chốt lúc tạo dòng hạn mức) rồi tải tệp lớn hơn chỗ trống | Bị từ chối **trước khi tải byte nào**, nút "Xem danh sách để xóa"; xem/xóa vẫn dùng được (US4) |
| 8 | Hai trình duyệt cùng tài khoản tải đồng thời, mỗi bên 400 MB, chỗ trống 500 MB | Đúng một tệp được nhận, tệp kia bị từ chối (US4 kịch bản 3) |
| 9 | Tải lại đúng ảnh đã có (đổi tên tệp) | "Tệp này đã có trong thư viện" + liên kết; thư viện vẫn **một** ô; dung lượng không đổi (US7); tài khoản khác tải cùng ảnh ⇒ có bản riêng |
| 10 | Đăng nhập cộng tác viên; xóa tệp mình tải / tệp của chủ | Tệp mình: xóa được; tệp của chủ: không có nút, API trả `MEDIA_DELETE_NOT_OWNER` (FR-018) |
| 11 | Xóa ảnh (nhà cung cấp "bài dùng media" giả trả bài nháp / bài lên lịch) | Bài nháp: hộp liệt kê **từng bài** rồi cho xóa; bài lên lịch: bị chặn, liệt kê bài, không có trạng thái xóa dở (US6) |
| 12 | Gọi `MediaPublicApi.issuePublicUrl` (qua kiểm thử/REPL dev) rồi mở URL ở cửa sổ ẩn danh; đổi một ký tự trong khóa; chờ hết hạn (đồng hồ giả lập) | Mở đúng một tệp; sửa khóa/tài khoản khác ⇒ bị từ chối; hết hạn ⇒ bị từ chối (US5, SC-006) |
| 13 | Dừng Worker giữa lúc xử lý (kill); bật lại | Việc chạy lại, kết quả cuối giống hệt, không tệp trùng (US3 kịch bản 6) |
| 14 | Đặt `UploadGate` giả "hết hạn" | Tải bị chặn (`MEDIA_PLAN_EXPIRED`); xem/xóa vẫn được (FR-018) |

## 3. Kiểm chứng thử nghiệm kỹ thuật (R4, R1) — trước khi coi các phần phụ thuộc là xong

| Thử nghiệm | Tiêu chí đạt | Nếu không đạt |
|---|---|---|
| **HEIC** (R4): ảnh iPhone 12 MP qua bộ giải mã WASM + `sharp` trong Worker | ≤ 5 giây, đúng chiều, RSS đỉnh ≤ 500 MB, màu sRGB | thử dựng libvips có libheif; nếu vẫn không đạt → bỏ HEIC khỏi `MEDIA_ACCEPTED` (cập nhật spec) |
| **Multipart trên MinIO và vStorage** (R1, V5): 25 MiB / 4 phần, ngắt giữa chừng | `listParts` đúng, ghép sau khi bù phần | video lớn quay về tải lại cả tệp; ghi rủi ro vào SC-002 |
| **`Content-Length` ký trong URL phần** (R1) | phần quá cỡ bị kho từ chối | chấp nhận bác ở bước xác nhận (đã có trong hợp đồng) |
| **ffmpeg lấy khung hình** (R5): MP4 có `moov` ở cuối, MOV, video xoay 90° | thumbnail đúng chiều ≤ 2 phút/video 500 MB | điều chỉnh vị trí lấy khung/`-ss` |
| **Hiệu năng lưới** (SC-007): 200 tệp trên 4G giả lập | lưới đầu ≤ 3 giây, đổi bộ lọc ≤ 1 giây | giảm `limit`, nạp lười mạnh hơn; xem R14 (CDN) |
| **Thông lượng Worker** (SC-003/010): lô 10 ảnh và lô 100 ảnh | 95% ảnh trong lô 10 ≤ 30 giây; `publish` của tài khoản khác không trễ | xem R11 (đổi `max_per_tenant` trong `infra.queue_settings`) |

## 4. Dọn sau khi thử

`docker compose down` (giữ dữ liệu) hoặc `docker compose down -v` (xóa dữ liệu dev); tệp trong MinIO dev nằm ở volume của compose.
