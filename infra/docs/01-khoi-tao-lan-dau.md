# 01 – Khởi tạo lần đầu (việc làm tay, một lần)

Terraform dựng được hầu hết hạ tầng, nhưng **một số thứ phải làm tay** vì chúng là "gốc" mà Terraform cần có sẵn để chạy
(tài khoản, khóa, bucket lưu trạng thái…) hoặc nhà cung cấp chưa cho tự động hóa (KMS, CDN, kho ảnh, IAM). Danh sách đầy
đủ và nghiệm thu nằm ở `specs/007-terraform-infra-environments/contracts/one-time-bootstrap.md`; tài liệu này hướng dẫn
từng bước và **giải thích vì sao**.

> Kiểm tiến độ bất cứ lúc nào: `pnpm infra bootstrap-check staging`. Mục "tự xác nhận" ghi ngày bằng
> `pnpm infra bootstrap-check staging --mark A1`.

Làm theo **đúng thứ tự**: A → B → C (cho `staging`) → C (cho `production`). Ảnh chụp màn hình: _(điền khi dựng thật)_.

## A. Tài khoản (một lần cho cả dự án)

| Mục    | Làm gì                                                                                                         | Vì sao                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A1** | Mở tài khoản VNG Cloud. Bật xác thực hai lớp cho tài khoản **gốc**. Cất mã khôi phục **ngoài máy** (giấy, két) | Tài khoản gốc là chìa khóa vạn năng; mất nó là mất tất cả                      |
| **A2** | Xin hạn mức: 3 máy 4 vCPU/8 GB + 1 máy tạm, 2 cân bằng tải, đĩa 300 GB                                         | Mặc định tài khoản mới hạn mức thấp, dựng sẽ bị từ chối giữa chừng             |
| **A3** | Tạo **người dùng IAM cá nhân** cho người vận hành; từ nay không dùng tài khoản gốc hằng ngày                   | Nếu lộ mật khẩu hằng ngày, thiệt hại giới hạn; có nhật ký ai làm gì (FR-023)   |
| **A4** | Bật/xác nhận **nhật ký hoạt động quản trị** (ai, làm gì, lúc nào)                                              | Điều tra được khi có sự cố; nếu nhà cung cấp không có (câu V14) thì ghi rủi ro |

Ghi dấu: `--mark A1`, `--mark A2`, `--mark A3`, `--mark A4`.

## B. Dùng chung hai môi trường (một lần)

| Mục    | Làm gì                                                                                                                                                        | Vì sao                                                                    | Kiểm                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| **B1** | vCR: tạo kho ảnh **riêng tư** với hai kho con `server`, `web`                                                                                                 | Ảnh ứng dụng không được công khai                                         | `--mark B1`                                        |
| **B2** | Robot `push` (đẩy + kéo). Lưu trong trình quản lý mật khẩu của bạn. **Không** đưa vào cụm nào                                                                 | Quyền đẩy ảnh = quyền thay mã chạy thật; chỉ người vận hành giữ           | `--mark B2`; `smoke` kiểm không Secret nào chứa nó |
| **B3** | Robot `pull-staging`, `pull-production` (**chỉ kéo**)                                                                                                         | Cụm chỉ cần kéo ảnh; lộ khóa này không cho ai đổi mã                      | `--mark B3` (thử đẩy phải bị từ chối)              |
| **B4** | Bật luật "thẻ ảnh không ghi đè" nếu vCR có (câu V11)                                                                                                          | Chặn đẩy đè một thẻ đã dùng. Dù có hay không, ta vẫn **buộc dùng digest** | `--mark B4`                                        |
| **B5** | GitHub: tạo Environment `staging-readonly`, `production-readonly`; nhập chứng thực của tài khoản `drift-<env>` (chỉ đọc) và khóa S3 chỉ đọc bucket trạng thái | Quy trình kiểm lệch hằng ngày chỉ được **đọc**, không bao giờ áp dụng     | `--mark B5`                                        |

## C. Mỗi môi trường (làm hai lần: `staging`, rồi `production`)

| Mục     | Làm gì                                                                                                                                   | Vì sao                                                                             | Kiểm                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **C1**  | Tạo project `<prefix>-<env>`; ghi `project_id` vào `infra/envs/<env>.tfvars`                                                             | Mỗi môi trường một project = ranh giới cứng                                        | tự động                                                                   |
| **C2**  | Tài khoản dịch vụ `terraform-<env>`: quản lý mạng, cụm, cân bằng tải, kho tệp **chỉ trong project này**                                  | Khóa của thử nghiệm không được chạm project phát hành (V2)                         | tự động: thấy project mình, **không thấy** project kia                    |
| **C3**  | Tài khoản dịch vụ `drift-<env>`: **chỉ đọc**, cùng phạm vi                                                                               | Cho quy trình tự động kiểm lệch                                                    | `--mark C3` (thử tạo nhóm bảo mật phải bị từ chối)                        |
| **C4**  | Tài khoản dịch vụ `app-<env>` (không quyền quản trị)                                                                                     | Ứng dụng chỉ ghi/đọc đối tượng bucket media                                        | kiểm sau khi dựng                                                         |
| **C5**  | Tài khoản dịch vụ `dbbackup-<env>`                                                                                                       | CSDL chỉ ghi vào bucket sao lưu                                                    | kiểm sau khi dựng                                                         |
| **C6**  | Khóa S3 cho C2–C5                                                                                                                        | Công cụ nói chuyện với kho tệp bằng giao diện S3                                   | tự động (khóa của C2)                                                     |
| **C7**  | Bucket trạng thái `<prefix>-tfstate-<env>`: riêng tư, **bật lưu phiên bản**, mã hóa khi lưu, giữ phiên bản cũ ≥ 90 ngày, vùng trong nước | Trạng thái Terraform là "bộ nhớ" của hạ tầng; mất/hỏng nó rất đau, nên giữ lịch sử | tự động; mã hóa: `--mark C7-encryption` nếu vStorage mã hóa mặc định (V5) |
| **C8**  | Khóa KMS `<prefix>-<env>-platform-tokens`; cấp quyền dùng cho `app-<env>`; điền `kms_key_id`                                             | Mã quyền thật của mạng xã hội phải mã hóa bằng khóa này (hiến pháp VII)            | tự động: `kms_key_id` không còn `TODO-P6`                                 |
| **C9**  | Điểm phân phối CDN (làm **sau** khi dựng) – xem [03](03-dns-va-chung-chi.md)                                                             | Giao diện phục vụ qua CDN trong nước                                               | sau khi dựng                                                              |
| **C10** | Bản ghi DNS theo `pnpm infra outputs <env>` (làm **sau** khi dựng)                                                                       | Đưa tên miền về hệ thống                                                           | `pnpm infra dns-check <env>`                                              |
| **C11** | Hồ sơ chứng thực cục bộ `infra/.credentials/<env>.env`                                                                                   | Công cụ đọc khóa ở đây; tệp bị `.gitignore`, **không bao giờ commit**              | tự động                                                                   |
| **C12** | `drill-production`: **chỉ đọc** bucket sao lưu phát hành (chỉ production)                                                                | Diễn tập khôi phục không được phép sửa/xóa sao lưu thật                            | `--mark C12`                                                              |

### Tạo hồ sơ chứng thực (C11)

1. Chép `infra/.credentials/.env.example` thành `infra/.credentials/staging.env`.
2. Điền bốn biến: mã khách và bí mật của `terraform-staging` (C2), khóa S3 của nó (C6).
3. Tệp này chỉ nằm trên máy bạn. Quyền chỉ chủ sở hữu. Đừng gửi qua chat/email.

### Điền tham số thật

Mở `infra/envs/staging.tfvars` và `infra/envs/staging.backend.hcl`, thay mọi chỗ ghi `TODO-P6-…` bằng giá trị thật
(`project_id`, `kms_key_id`, `admin_cidrs` – **địa chỉ IP của bạn**, `base_domain`, `flavor`, `kubernetes_version`,
`lb_package_id`, `storage_class`, khóa SSH công khai…). Giải thích từng khóa ở [02](02-dung-moi-truong.md).

## D. Thứ tự rút gọn

A1 → A4 → B1 → B5 → C1 → C2 → C3 → C6 → C7 → C8 → C11 → (dựng bằng `pnpm infra up`) → C4, C5 → C9 → C10.

## Lỗi thường gặp

| Hiện tượng                                        | Nguyên nhân                          | Cách xử lý                                                                                                      |
| ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `[thiếu] C2 … thấy cả project của production`     | Tài khoản dịch vụ có quyền rộng      | Giới hạn lại phạm vi IAM theo project (câu V2); nếu nhà cung cấp không giới hạn được, **dừng và hỏi chủ dự án** |
| `[thiếu] C7 … chưa bật lưu phiên bản`             | Bucket trạng thái tạo thiếu tùy chọn | Bật "Versioning" trong cấu hình bucket                                                                          |
| `Hồ sơ chứng thực không thuộc môi trường staging` | Dùng nhầm khóa của môi trường khác   | Dùng đúng `infra/.credentials/staging.env`                                                                      |
| `kubectl`/`terraform` "không chạy được"           | Chưa cài hoặc sai phiên bản          | Xem [02](02-dung-moi-truong.md) mục 1                                                                           |
