# Dựng (hoặc dựng lại) máy Jenkins

Mục tiêu: từ máy trống tới Jenkins chạy đủ thư mục và hai tác nhân trong **≤ 4 giờ** (SC-014). Toàn bộ cấu hình là
mã trong kho (`infra/ci/`, `ops/ci/`) – chỉ **bí mật** là việc nhập tay.

> Trạng thái: bản đầu, **chưa được diễn tập trên máy thật** (việc T052 và T097). Sau lần dựng đầu, ghi thời gian
> và các bước phải sửa vào mục "Lịch sử diễn tập" bên dưới.

## Trước khi bắt đầu

- ADR-11 đã ở trạng thái "Chấp nhận" và điểm quyết định T038 đã xong (gói GitHub, nhà cung cấp + cỡ máy ảo, số
  thành viên). Không dựng máy ảo khi chưa có hai thứ này.
- Có tài khoản nhà cung cấp đám mây trong nước và quyền tạo máy ảo; máy cá nhân đã cài Terraform.
- Có quyền quản trị kho GitHub (tạo GitHub App, ruleset).

## Các bước

1. **Máy ảo** – `terraform init && terraform apply` trong `infra/ci/` với `admin_cidrs` = địa chỉ công cộng của
   đội. Ghi lại đầu ra `public_ip` (gửi cho tính năng 007 đưa vào danh sách được phép của hai cụm).
2. **Chờ `cloud-init`** chạy `ops/ci/vm/bootstrap.sh` xong (xem `/var/log/cloud-init-output.log`). Script chạy lại
   được nhiều lần; chạy tay: `sudo REPO_DIR=/opt/app-repo ADMIN_CIDRS=… bash ops/ci/vm/bootstrap.sh`.
3. **GitHub** (mục "Tạo GitHub App" trong [credentials.md](credentials.md)): hai GitHub App `ci` và `deploy`,
   ứng dụng OAuth, bí mật webhook. Bot + nhóm Telegram.
4. **Nhập bí mật** vào `/etc/jenkins-secrets/` đúng tên tệp ở [credentials.md](credentials.md) (quyền `0400`, chủ
   `jenkins`); nhập bí mật kết nối của hai tác nhân vào `/etc/jenkins-agent/{ci,deploy}.secret` và tải
   `agent.jar` về `/opt/jenkins-agent/` từ chính bộ điều khiển.
5. **Khởi động lại bộ điều khiển** để JCasC nạp lại bí mật: (chạy dưới người dùng `jenkins`) `docker compose -f ops/ci/jenkins/compose.yaml restart`, rồi `systemctl start jenkins-agent-ci jenkins-agent-deploy`.
6. **Kiểm tra**: đăng nhập từ địa chỉ trong `admin_cidrs`; thấy thư mục `ci/`, `deploy/staging/`,
   `deploy/production/`, `maintenance/`; hai tác nhân `agent-ci`, `agent-deploy` trực tuyến; `0` bộ thực thi
   trên bộ điều khiển (Manage Jenkins → Nodes).
7. **Áp luật bảo vệ nhánh** (T060) và chạy phép thử cô lập (quickstart B6–B8).

## Khi Jenkins ngừng hoạt động

Ứng dụng ở hai môi trường **không bị ảnh hưởng**. Hợp nhất bị khóa vì `ci/gates` không báo về – đúng ý. Cần phát
hành khẩn: xem `docs/ci-cd/emergency-deploy.md`.

## Lịch sử diễn tập

| Ngày        | Người làm | Thời gian từ máy trống tới Jenkins chạy | Ghi chú / điều đã sửa |
| ----------- | --------- | --------------------------------------- | --------------------- |
| _(chưa có)_ |           |                                         |                       |
