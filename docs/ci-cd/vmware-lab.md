# Dựng Jenkins thử nghiệm trên máy ảo VMware

Thay cho việc thuê máy ảo đám mây (Terraform ở `infra/ci/`, chưa viết vì chưa chọn nhà cung cấp – T039). Phù hợp để thử
toàn bộ đường ống mà không tốn tiền; **không** thay thế máy chạy thật (xem "Khác biệt" dưới đây).

## 1. Tạo máy ảo

| Mục          | Giá trị                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| Hệ điều hành | Ubuntu Server **24.04 LTS**                                                              |
| CPU / RAM    | 4 vCPU / 8 GB (ba làn kiểm tra song song + bộ điều khiển Jenkins)                        |
| Đĩa          | 80 GB (ảnh Docker + `JENKINS_HOME`); có thể thêm đĩa thứ hai gắn `/var/lib/jenkins-data` |
| Mạng         | **Bridged** (cùng dải mạng nhà để máy bạn truy cập Jenkins bằng địa chỉ riêng)           |
| Tài khoản    | một người dùng quản trị có `sudo`; bật OpenSSH khi cài                                   |

Sau khi cài: `sudo apt-get update && sudo apt-get upgrade -y`, đặt địa chỉ IP cố định (hoặc giữ chỗ trên bộ định tuyến).

## 2. Đưa mã lên máy ảo và chạy tập lệnh dựng

```bash
sudo apt-get install -y git
sudo git clone https://github.com/<chủ>/<kho>.git /opt/app-repo      # kho riêng tư: dùng HTTPS + mã truy cập cá nhân tạm, rồi xóa
cd /opt/app-repo
# ADMIN_CIDRS: dải/địa chỉ máy bạn được phép vào Jenkins (nginx + nftables), cách nhau dấu phẩy
sudo REPO_DIR=/opt/app-repo ADMIN_CIDRS=192.168.1.0/24 bash ops/ci/vm/bootstrap.sh
```

`bootstrap.sh` chạy lại nhiều lần an toàn. Nó cài gói hệ thống, tạo ba người dùng tách biệt (`jenkins`, `ci-agent`,
`deploy-agent`), Docker rootless riêng, Node/helm/kubectl/trivy (kiểm SHA-256), nftables, nginx, đơn vị systemd của hai
tác nhân và dựng bộ điều khiển Jenkins. Thư mục `/etc/jenkins-secrets/` được tạo **rỗng**.

## 3. Phần còn lại giống [rebuild-jenkins.md](rebuild-jenkins.md) (bước 3 trở đi)

GitHub App, bí mật, khởi động lại bộ điều khiển, kiểm tra thư mục và hai tác nhân. Hai khác biệt khi chạy trong mạng nhà:

| Chủ đề                 | Cách xử lý trong VMware                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Webhook của GitHub** | GitHub **không** gọi được vào máy trong mạng nhà. Dùng **thăm dò**: các job đã có `pollSCM`/quét kho mỗi 5–10 phút (R5) nên vẫn chạy, chỉ chậm hơn vài phút; không mở cổng nào ra Internet. (Muốn tức thì thì dùng Cloudflare Tunnel – cân nhắc riêng về an toàn.) Quy tắc nginx "chỉ `/github-webhook/` công khai" **chưa được thử thật**. |
| **Địa chỉ IP**         | Địa chỉ trong mạng nhà không phải IP công cộng cố định. Danh sách cho phép của hai cụm (007) sẽ cần cập nhật khi chuyển sang máy chạy thật.                                                                                                                                                                                                 |
| **Môi trường đích**    | `staging` / `production` chưa tồn tại (007) nên `provisioned: false`: chặng triển khai kết thúc "chưa có môi trường đích". Muốn thử rollout thật, dựng cụm k3s/kind trong VM thứ hai (ngoài phạm vi 008).                                                                                                                                   |

## 4. Kiểm tra sau khi dựng

- Đăng nhập Jenkins từ máy bạn; thấy thư mục `ci/`, `deploy/staging/`, `deploy/production/`, `maintenance/`.
- Hai tác nhân `agent-ci` và `agent-deploy` trực tuyến; bộ điều khiển có **0** bộ thực thi.
- Job `ci/sandbox` chạy được `Jenkinsfile.ci` của nhánh đang làm.
- Ghi thời gian từ máy trống tới lúc đạt các mục trên vào "Lịch sử diễn tập" của [rebuild-jenkins.md](rebuild-jenkins.md).

## Khác biệt với máy chạy thật

Máy VMware không có sao lưu tự động của nhà cung cấp, không có IP công cộng, nguồn điện/mạng nhà có thể ngắt. Trước khi
dùng cho `production` phải dựng lại trên nhà cung cấp trong nước (ADR-10), có đĩa dữ liệu sao lưu cho
`/var/lib/jenkins-data`, và diễn tập SC-014 (dựng lại ≤ 4 giờ).

## Lịch sử diễn tập

| Ngày        | Người làm | Thời gian từ máy trống tới Jenkins chạy | Điều đã sửa trong tài liệu |
| ----------- | --------- | --------------------------------------- | -------------------------- |
| _(chưa có)_ |           |                                         |                            |
