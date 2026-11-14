# 08 – Xử lý sự cố

Đọc theo triệu chứng. Với mọi sự cố: **đừng vội sửa tay trên bảng điều khiển** — sửa tay tạo "lệch" mà kiểm tra lệch sẽ báo.

## 1. Dựng lỗi giữa chừng (hết hạn mức, lỗi mạng)

Chạy lại `pnpm infra up <env>` (hoặc `plan` rồi `apply`). Bước đã xong được bỏ qua, không tạo trùng. Hết hạn mức: xin
thêm (A2) rồi chạy lại. Giữ nguyên bản xem trước cũ nếu còn hạn; quá 24 giờ thì `plan` lại.

## 2. Trạng thái bị khóa

Triệu chứng: "state lock" / "stack … đang bị khóa".

1. Tìm ai đang chạy (một cửa sổ/phiên khác của bạn?). Đợi nó xong.
2. Chắc chắn không ai chạy mà khóa còn sót (máy tắt giữa chừng): `terraform -chdir=infra/stacks/<stack> force-unlock <ID>`
   (ID in trong thông báo) — **có chủ đích**, vì đây là ngoại lệ duy nhất dùng `terraform` trực tiếp.
3. Nhánh dự phòng (khi vStorage không hỗ trợ khóa gốc, V6): xóa đối tượng `locks/<stack>.json` trong bucket trạng thái.

## 3. Mất hoặc hỏng tệp trạng thái

Bucket trạng thái bật lưu phiên bản (C7). Khôi phục **phiên bản trước** của đối tượng `<stack>.tfstate`:
liệt kê phiên bản của khóa đó, chọn bản ngay trước lúc hỏng, sao chép lại thành bản hiện tại. Sau đó `pnpm infra plan <env>`:
phải ra "Không có thay đổi" (hoặc đúng những gì bạn vừa làm). Không bao giờ xóa tệp trạng thái để "dựng lại từ đầu".

## 4. Issue `infra-drift:<env>`

Mỗi dòng: `địa chỉ: thuộc tính (đang là … → mã khai …)`. Quyết định **một trong hai**:

- **Sửa tay đúng ý** (ví dụ mở thêm một địa chỉ quản trị): đưa vào mã/tham số, commit, đi theo [05](05-quy-trinh-thay-doi.md).
- **Sửa tay nhầm hoặc không rõ ai**: hoàn tác bằng `pnpm infra plan <env>` rồi `apply` (đưa hạ tầng về đúng mã); kiểm nhật
  ký hoạt động quản trị (A4) xem ai đã sửa.
  Hết lệch thì issue tự đóng ở lần chạy sau. Issue "lần chạy lỗi" nghĩa là chính việc kiểm tra hỏng (khóa hết hạn, mạng): xem
  nhật ký lần chạy.

## 5. Chứng chỉ không gia hạn

cert-manager gia hạn tự động trước hạn 30 ngày. Nếu `certmanager_certificate_expiration_timestamp_seconds` còn < 14 ngày
(H3 cảnh báo): xem [03](03-dns-va-chung-chi.md) mục 4 (`kubectl describe certificate`, `challenge`). Nguyên nhân hay gặp: DNS
đã đổi, cổng 80 bị chặn, vượt giới hạn Let's Encrypt.

## 6. Mất một máy / mất bản chính CSDL

- **Mất một máy:** `api` ×2 và `worker` ×2 trải khác máy, nên ứng dụng vẫn phục vụ. Nhóm máy tự dựng lại máy. Theo dõi
  `kubectl get nodes -w`. Nếu máy không về: kiểm hạn mức (A2) và `pnpm infra plan` xem có lệch.
- **Mất bản chính CSDL:** CloudNativePG tự đưa bản dự phòng lên làm chính; dịch vụ `pg-rw` giữ nguyên. Xem
  `kubectl get cluster pg -n database` (cột `Primary`). Không đổi cấu hình ứng dụng.
- **Mất cả CSDL / dữ liệu hỏng:** khôi phục từ sao lưu — tài liệu 10 (đợt sau) và `pnpm infra drill`.

## 7. Hủy hẳn môi trường thử nghiệm

CLI **cố ý không có lệnh hủy** (tránh xóa nhầm). Khi thật sự cần:

1. Đảm bảo không còn dữ liệu cần giữ.
2. Đặt `deletion_protection = false`, áp dụng.
3. Dùng `terraform` **trực tiếp** có chủ đích: `terraform -chdir=infra/stacks/platform destroy -var-file=../../envs/staging.tfvars`
   rồi `…/cloud` (cần `init` với backend như `pnpm infra` dùng và các biến môi trường chứng thực).
4. Dọn tay các thứ ngoài Terraform: bucket trạng thái, tài khoản dịch vụ, CDN, DNS, khóa KMS, kho ảnh nếu không dùng chung.
