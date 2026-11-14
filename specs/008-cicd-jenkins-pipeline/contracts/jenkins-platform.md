# Hợp đồng: Nền tảng Jenkins

Áp dụng cho `infra/ci/**`, `ops/ci/jenkins/**`, `ops/ci/vm/**`. Lý do thiết kế: [research.md](../research.md)
R1–R6, R19. ADR: `docs/adr/ADR-11-jenkins-cicd.md`.

## 1. Máy ảo

| Thuộc tính | Giá trị |
|---|---|
| Vị trí | đám mây trong nước (cùng nhà cung cấp với `007`), **ngoài** cả hai cụm Kubernetes, mạng con riêng |
| Kích thước ban đầu | 8 vCPU · 16 GB RAM · đĩa 200 GB (điều chỉnh sau khi đo SC-003) |
| Định nghĩa | Terraform `infra/ci/` (trạng thái riêng, nhãn chi phí `component=ci`) + `cloud-init` → `ops/ci/vm/bootstrap.sh` |
| Sao lưu | chụp đĩa hằng ngày, giữ 14 bản; `JENKINS_HOME` nằm trên đĩa dữ liệu riêng |
| Số lượng | 1 (không dự phòng; SC-014: dựng lại ≤ 4 giờ) |

## 2. Tiến trình trên máy

| Thành phần | Chạy dưới | Ghi chú |
|---|---|---|
| nginx | hệ thống | TLS; định tuyến ở mục 3 |
| Bộ điều khiển Jenkins | container, người dùng `jenkins` | `numExecutors: 0`; cấu hình bằng JCasC + Job DSL |
| Tác nhân `ci` | systemd, người dùng `ci-agent`, Docker rootless riêng | chạy mã pull request |
| Tác nhân `deploy` | systemd, người dùng `deploy-agent`, Docker rootless riêng | chạy mã đã hợp nhất |

Bất biến:

- Thư mục nhà của `jenkins`, `ci-agent`, `deploy-agent` có quyền `0700`; ba người dùng không chung nhóm.
- `ci-agent` không thuộc nhóm `docker` của hệ thống, không có `sudo`.
- Mã chạy trên tác nhân `ci` MUST NOT sửa được cấu hình hay phần mở rộng của Jenkins (FR-042): bộ điều khiển không
  chạy việc; job ở `ci/` không có quyền `Overall/Administer` hay `Job/Configure`.

## 3. Mạng (FR-041)

Vào:

| Nguồn | Đích | Cho phép |
|---|---|---|
| Internet | `443 /github-webhook/` | có – Jenkins kiểm chữ ký, sai → từ chối |
| Danh sách địa chỉ của đội (`var.admin_cidrs`) | `443 /*` | có – đăng nhập GitHub OAuth |
| Danh sách địa chỉ của đội | `22` | có – khóa SSH cá nhân (đường hầm khi ở ngoài danh sách) |
| Còn lại | mọi cổng | **từ chối** |

Ra (lọc theo người dùng hệ điều hành bằng nftables):

| Đích | `jenkins` | `ci-agent` | `deploy-agent` |
|---|---|---|---|
| GitHub (API, git) | có | có (đọc mã) | có |
| Kho gói npm, kho ảnh công khai (kéo ảnh nền) | — | có | có |
| Kho ảnh riêng tư của test / release | — | **không** | có |
| Điểm quản trị cụm test / release | — | **không** | có |
| Nơi phục vụ giao diện tĩnh (S3) test / release | — | **không** | có |
| Địa chỉ công khai của `api`/web (kiểm tra khói) | — | — | có |
| Telegram Bot API | — | **không** | có |
| CSDL, kho tệp media, KMS của bất kỳ môi trường nào | **không** | **không** | **không** |

Phía môi trường (yêu cầu gửi `007`): điểm quản trị cụm và kho ảnh chỉ nhận từ địa chỉ của máy Jenkins + danh sách
quản trị.

## 4. Cấu hình bằng mã

```text
ops/ci/jenkins/
├── Dockerfile            # FROM jenkins/jenkins:<LTS>@sha256:…  + jenkins-plugin-cli
├── plugins.txt           # <tên>:<phiên bản> – không "latest"
├── casc/
│   ├── security.yaml     # GitHub OAuth, ma trận quyền, 0 bộ thực thi, CSRF, tắt CLI qua remoting
│   ├── credentials.yaml  # khai báo theo thư mục; giá trị = ${tệp bí mật} do bootstrap gắn vào
│   ├── nodes.yaml        # hai tác nhân, nhãn ci / deploy
│   └── jobs.yaml         # gọi Job DSL
├── jobs/*.groovy         # ci/gates, ci/sandbox, deploy/<env>/{deploy,redeploy}, maintenance/*
└── compose.yaml          # bộ điều khiển
```

Phần mở rộng tối thiểu (cố định phiên bản lúc implement): Configuration as Code, Job DSL, Pipeline, GitHub Branch
Source, Checks API + GitHub Checks, Credentials Binding, Matrix Authorization, GitHub Authentication, Lockable
Resources, Timestamper, Audit Trail, và một trong hai phần mở rộng nạp `Jenkinsfile` từ nhánh tin cậy (research R4).
Thêm phần mở rộng = sửa `plugins.txt` qua pull request có chủ mã duyệt.

## 5. Phân quyền (đăng nhập từng cá nhân)

| Quyền | `developers` | `release-managers` (SA, PO) | Ẩn danh |
|---|---|---|---|
| Xem job, nhật ký ở mọi thư mục | có | có | không |
| Chạy lại ở `ci/` | có | có | không |
| Chạy tay / chạy lại `deploy/staging/*` | có | có | không |
| Chạy tay / chạy lại `deploy/production/*`, `redeploy` release | **không** | có | không |
| Sửa cấu hình job, thông tin xác thực | không (chỉ qua mã) | không (chỉ qua mã) | không |
| Quản trị Jenkins | không | SA (để khắc phục sự cố) | không |

Lần thử bị từ chối và mọi thao tác quản trị được Audit Trail ghi vào tệp nhật ký riêng, giữ 12 tháng (US4-4).

## 6. Thông tin xác thực

Danh sách và phạm vi: [data-model.md](../data-model.md) mục 6. Quy tắc:

- Giá trị bí mật **không** nằm trong kho mã; `bootstrap.sh` đọc từ thư mục `/etc/jenkins-secrets/` (quyền `0400`,
  chủ `jenkins`) do SA nhập tay lần đầu theo tài liệu vận hành.
- Mỗi thông tin có ngày xoay; job `maintenance/credential-age` báo Telegram khi quá 90 ngày.
- Thông tin của `deploy/production/` chỉ dùng được bởi job trong thư mục đó; phép thử SC-010 nằm trong quickstart.

## 7. Giữ dữ liệu

| Dữ liệu | Thời gian |
|---|---|
| Lần chạy `deploy/*` (nhật ký + sản phẩm lưu) | 400 ngày |
| Lần chạy `ci/gates` | 90 ngày hoặc 200 lần gần nhất mỗi pull request |
| Nhật ký Audit Trail | 12 tháng |
| Bản ghi triển khai | GitHub Deployments (không xóa) |

## 8. Khi Jenkins ngừng

- Ứng dụng ở hai môi trường không bị ảnh hưởng (Jenkins không nằm trên đường phục vụ).
- Hợp nhất bị khóa vì `ci/gates` không báo về (đúng ý: không hợp nhất khi chưa kiểm).
- Triển khai khẩn cấp bằng tay: SA dùng chính `ops/deploy/**` từ máy mình theo `docs/ci-cd/emergency-deploy.md`,
  và ghi nhận bằng một GitHub Deployment tạo tay (`kind` ghi chú "manual") – lịch sử không đứt.
