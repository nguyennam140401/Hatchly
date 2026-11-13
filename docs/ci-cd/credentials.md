# Thông tin xác thực của Jenkins

Nguyên tắc (FR-039, FR-040): **không có giá trị bí mật nào trong kho mã**; mỗi môi trường có thông tin riêng; chỉ
job trong thư mục tương ứng dùng được; xoay tối đa mỗi 90 ngày. Jenkins **không bao giờ** giữ mật khẩu vai trò
CSDL `owner`/`app`/`system`/`support`, khóa kho tệp media hay khóa KMS.

## Tạo GitHub App

Tạo hai ứng dụng ở GitHub → Settings → Developer settings → GitHub Apps:

| Ứng dụng | Quyền                                                                           | Dùng để                                                                              |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ci`     | Contents: đọc · Pull requests: đọc · Checks: ghi · Deployments: đọc             | chặng kiểm tra – đọc mã, đăng kết quả `ci/gates`                                     |
| `deploy` | Contents: ghi (chỉ nhánh `backmerge/*`) · Pull requests: ghi · Deployments: ghi | chặng triển khai – ghi bản ghi triển khai, mở pull request đưa bản sửa nóng về `dev` |

Cài đặt hai ứng dụng vào đúng kho. Tải khóa riêng (`.pem`) của mỗi ứng dụng. Thêm **ứng dụng OAuth** cho đăng
nhập Jenkins (callback `https://<địa-chỉ-jenkins>/securityRealm/finishLogin`), và **bí mật webhook** ngẫu nhiên
(≥ 32 ký tự) đặt ở cả webhook của GitHub App `ci` và cấu hình Jenkins. Telegram: tạo bot bằng BotFather, tạo nhóm,
thêm bot, lấy mã nhóm.

## Tệp trong `/etc/jenkins-secrets/` (quyền `0400`, chủ `jenkins`)

| Tệp                                                        | Nội dung                                      | Thư mục Jenkins dùng |
| ---------------------------------------------------------- | --------------------------------------------- | -------------------- |
| `github-oauth-client-id`, `github-oauth-client-secret`     | ứng dụng OAuth                                | đăng nhập            |
| `jenkins-url`                                              | địa chỉ công khai của Jenkins                 | cấu hình chung       |
| `github-app-ci-id`, `github-app-ci-key`                    | App `ci`                                      | `ci/`                |
| `github-app-deploy-id`, `github-app-deploy-key`            | App `deploy`                                  | `deploy/`            |
| `telegram-bot-token`, `telegram-chat-id`                   | bot + nhóm                                    | `deploy/`            |
| `staging/registry-user`, `staging/registry-password`       | kho ảnh test                                  | `deploy/staging/`    |
| `staging/kubeconfig`                                       | mã ServiceAccount `ci-deployer` của cụm test  | `deploy/staging/`    |
| `staging/static-site-key-id`, `staging/static-site-secret` | khóa S3 kho tệp tĩnh test                     | `deploy/staging/`    |
| `staging/smoke-account`, `staging/smoke-token`             | tài khoản + mã kiểm tra khói test             | `deploy/staging/`    |
| `production/…`                                             | cùng bộ tên như `staging/…`, **giá trị khác** | `deploy/production/` |

Tệp `staging/*` và `production/*` chỉ cần khi môi trường tương ứng đã có (tính năng 007).

## Xoay một thông tin xác thực

1. Tạo giá trị mới ở nơi phát hành (GitHub, nhà cung cấp đám mây…) – **chưa** thu hồi giá trị cũ.
2. Ghi giá trị mới vào đúng tệp ở `/etc/jenkins-secrets/` (giữ quyền `0400`).
3. Khởi động lại bộ điều khiển để JCasC nạp lại; chạy một lần job dùng thông tin đó để kiểm tra.
4. Thu hồi giá trị cũ.
5. Cập nhật ngày trong `ops/ci/rotation.json` (chỉ tên + ngày, không có giá trị) bằng pull request. Job
   `maintenance/credential-age` báo Telegram khi một thông tin quá 90 ngày.

## Khi nghi lộ thông tin

Xoay ngay (bước 1–4) rồi xem Audit Trail (`/var/lib/jenkins-data/audit/`) và nhật ký lần chạy của thư mục liên quan.
Thông tin của `deploy/production/` bị lộ → coi như sự cố an toàn: báo SA, xoay cả kubeconfig của cụm release.
