# Hợp đồng: danh sách khởi tạo một lần (FR-001, FR-023, research R12)

Đây là **toàn bộ** những việc được phép làm tay trên bảng điều khiển của nhà cung cấp và ở nơi đăng ký tên
miền. Việc nào không có trong danh sách này mà phải bấm tay là lỗi của tính năng (SC-001).

Lý do các mục này không nằm trong Terraform: hoặc phải có trước Terraform (tài khoản, nơi lưu trạng thái),
hoặc provider của VNG Cloud không có tài nguyên tương ứng (research R1), hoặc đặc tả quy định tạo tay (DNS).

Mỗi mục có một phép kiểm trong `pnpm infra bootstrap-check <env>` (cột cuối). Tài liệu hướng dẫn từng bước,
kèm ảnh chụp và giải thích lý do, viết ở bước implement: `infra/docs/01-khoi-tao-lan-dau.md`.

## A. Tài khoản (một lần cho cả dự án)

| # | Việc | Kiểm tự động |
|---|---|---|
| A1 | Mở tài khoản VNG Cloud; bật xác thực hai lớp cho tài khoản gốc; cất mã khôi phục ngoài máy | Không (tự xác nhận trong danh sách) |
| A2 | Xin hạn mức đủ cho: 3 máy 4 vCPU/8 GB + 1 máy tạm, 2 cân bằng tải, đĩa 300 GB | Liệt kê hạn mức qua API nếu có; không thì tự xác nhận |
| A3 | Tạo tài khoản người dùng IAM cá nhân cho người vận hành; không dùng tài khoản gốc hằng ngày (FR-023) | Chứng thực trong hồ sơ không phải của tài khoản gốc |
| A4 | Bật/xác nhận nhật ký hoạt động quản trị của tài khoản (FR-023, V14) | Không (tự xác nhận) |

## B. Dùng chung (một lần)

| # | Việc | Kiểm tự động |
|---|---|---|
| B1 | Tạo kho ảnh riêng tư trong vCR với hai kho con `server`, `web` | Gọi API kho ảnh bằng robot `pull-*` |
| B2 | Robot `push` (đẩy + kéo) – lưu ở trình quản lý mật khẩu của người vận hành; **không** đưa vào cụm nào | Không có trong bất kỳ `Secret` nào (kiểm ở `smoke`) |
| B3 | Robot `pull-staging`, `pull-production` (chỉ kéo) | Kéo được; **đẩy bị từ chối** |
| B4 | Bật luật thẻ ảnh không ghi đè nếu vCR có (V11) | Đẩy lại cùng thẻ bị từ chối; không có luật → cảnh báo, không lỗi (đã buộc dùng digest) |
| B5 | Trên GitHub: tạo Environment `staging-readonly`, `production-readonly`; nhập chứng thực của `drift-<env>` (chỉ đọc) và khóa S3 chỉ đọc bucket trạng thái | Quy trình `infra-drift` chạy tay một lần đạt (stack `cloud`) |

## C. Mỗi môi trường (làm hai lần: `staging`, `production`)

| # | Việc | Kiểm tự động |
|---|---|---|
| C1 | Tạo project `<prefix>-<env>` (máy chủ/cụm và kho tệp) | `project_id` trong tệp tham số tồn tại |
| C2 | Tài khoản dịch vụ `terraform-<env>`: quản lý mạng, cụm, cân bằng tải, kho tệp **chỉ trong project này** | Liệt kê được tài nguyên của project mình; **bị từ chối** ở project kia (SC-005) |
| C3 | Tài khoản dịch vụ `drift-<env>`: chỉ đọc, cùng phạm vi | Đọc được; thử tạo một nhóm bảo mật **bị từ chối** |
| C4 | Tài khoản dịch vụ `app-<env>`: không có quyền quản trị nào; sẽ được cấp quyền đối tượng trên bucket media bằng bucket policy do Terraform đặt | Sau khi dựng: đọc/ghi được media; **không** đổi được cấu hình bucket; **bị từ chối** ở bucket sao lưu, bucket trạng thái, và mọi bucket của môi trường kia |
| C5 | Tài khoản dịch vụ `dbbackup-<env>`: quyền đối tượng trên bucket sao lưu (cấp bằng bucket policy) | Sau khi dựng: ghi được bucket sao lưu; bị từ chối ở bucket media |
| C6 | Khóa S3 cho C2, C3, C4, C5 | Từng khóa xác thực được |
| C7 | Bucket trạng thái `<prefix>-tfstate-<env>`: riêng tư, bật lưu phiên bản, vùng trong nước | Tồn tại; có lưu phiên bản; mã hóa khi lưu; luật giữ phiên bản cũ ≥ 90 ngày; yêu cầu không xác thực bị từ chối; `terraform-<env>` đọc/ghi, `drift-<env>` chỉ đọc |
| C8 | Khóa KMS đối xứng `<prefix>-<env>-platform-tokens`; cấp quyền dùng cho `app-<env>` | Định danh trong tệp tham số tồn tại và đang hoạt động (nếu API cho phép – V4) |
| C9 | Điểm phân phối CDN: nguồn HTTP `origin-app.<base_domain>`, tên miền `app.<base_domain>`, tôn trọng tiêu đề cache của nguồn, bắt buộc HTTPS | Sau `dns-check`: `app.<base_domain>` trả 200 qua HTTPS, có tiêu đề của CDN, `index.html` không cache dài, tệp `/assets/*` cache 1 năm |
| C10 | Bản ghi DNS ở nơi đăng ký tên miền, theo đúng danh sách `pnpm infra outputs <env>` in ra (làm **sau** khi dựng stack `cloud`) | `pnpm infra dns-check <env>` |
| C11 | Hồ sơ chứng thực cục bộ `infra/.credentials/<env>.env` | CLI đọc được, đúng môi trường |

Riêng `production` thêm:

| # | Việc | Kiểm tự động |
|---|---|---|
| C12 | Tài khoản dịch vụ `drill-production`: **chỉ đọc** bucket sao lưu phát hành; quản lý mạng/cụm trong project phát hành | Đọc được bucket sao lưu; ghi/xóa **bị từ chối**; bị từ chối ở bucket media và khóa KMS |

## D. Thứ tự

```text
A1 → A2 → A3 → A4 → B1..B5
→ với mỗi môi trường:  C1 → C2..C6 → C7 → C8 → C11 → bootstrap-check
                        → pnpm infra up <env> (dừng ở bước DNS)
                        → C9 → C10 → dns-check → smoke
→ C12 (trước khi phát hành có dữ liệu thật)
```

## E. Đầu ra của `bootstrap-check`

Một dòng cho mỗi mục: `[đạt] C7 Bucket trạng thái …` / `[thiếu] C8 Khóa KMS: không tìm thấy <id>` /
`[tự xác nhận] A1 …`. Mã thoát 4 khi còn mục `[thiếu]`. Mục "tự xác nhận" được đánh dấu trong
`infra/envs/<env>.bootstrap.json` (commit được, không bí mật): `{ "A1": "2026-11-20", … }`.

## F. Xoay và thu hồi

Khóa S3 và mật khẩu của tài khoản dịch vụ xoay ≤ 12 tháng hoặc ngay khi nghi lộ: tạo khóa mới → cập nhật hồ
sơ cục bộ / `Secret` / GitHub Environment → chạy `bootstrap-check` → xóa khóa cũ. Thủ tục chi tiết thuộc tài
liệu vận hành (FR-030).
