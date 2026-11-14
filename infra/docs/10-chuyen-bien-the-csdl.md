# 10 – Chuyển biến thể CSDL (`cnpg` ↔ `managed`)

Mặc định ta tự chạy PostgreSQL bằng **CloudNativePG** (`db_variant = "cnpg"`) vì chắc chắn có khôi phục theo thời điểm.
Nếu VNG Cloud có dịch vụ CSDL quản lý **đạt đủ yêu cầu**, có thể chuyển sang `managed` (`db_variant = "managed"`) để bớt
việc vận hành. Ứng dụng **không đổi gì** ngoài bí mật kết nối, vì địa chỉ ổn định `pg-rw` được giữ.

## 1. Điều kiện chuyển

- **V1 đạt:** vDB PostgreSQL lưu nhật ký giao dịch liên tục và khôi phục về thời điểm bất kỳ (mất ≤ 5 phút, khôi phục ≤ 1 giờ).
- PostgreSQL ≥ 13 có Row-Level Security; hỗ trợ các vai trò và `sslmode=require` như hợp đồng CSDL.
- Chi phí hợp lý so với tự chạy (V10) — tính cả công vận hành tiết kiệm được.

## 2. Hiện thực còn thiếu

Biến thể `managed` mới **khai hợp đồng**: `infra/modules/provider-vngcloud/managed-db.tf` hiện chặn bằng `precondition`. Khi V1
đạt:

1. Viết `vngcloud_vdb_postgresql_cluster` (kèm nhóm cấu hình, sao lưu) trong `managed-db.tf`.
2. Điền đầu ra `database.managed_host` / `managed_port` ở `outputs.tf` từ tài nguyên đó.
3. Dịch vụ `ExternalName` tên `pg-rw` đã khai sẵn ở `stacks/platform/main.tf` (gỡ `precondition` giữ chỗ).
4. Thêm các tài nguyên mới vào `tooling/infra/lib/protected-resources.mjs` (đã có `vngcloud_vdb_postgresql_cluster`).

## 3. Các bước chuyển `cnpg` → `managed` (thử ở thử nghiệm trước)

1. Dựng CSDL quản lý song song; tạo vai trò và CSDL `app` như `pnpm db:bootstrap`.
2. Sao lưu logic từ CloudNativePG (`pg_dump`/`pg_dumpall`) hoặc khôi phục sao lưu vật lý nếu nhà cung cấp hỗ trợ.
3. Tạm dừng ghi (đưa ứng dụng về chế độ bảo trì), nạp dữ liệu, kiểm số dòng.
4. Đặt `db_variant = "managed"` và `managed_db = { host = "…" }`; `plan` → `apply` ở thử nghiệm: `pg-rw` giờ trỏ `ExternalName`.
5. Cập nhật `Secret` chuỗi kết nối (`pnpm infra secrets rotate …`) nếu mật khẩu mới; khởi động lại `api`, `worker`.
6. Chạy `pnpm infra smoke staging`, rồi lặp lại cho production **sau khi** diễn tập khôi phục (07) trên CSDL quản lý.

## 4. Chuyển ngược `managed` → `cnpg`

Làm tương tự theo chiều ngược lại: dựng Cluster CloudNativePG, nạp dữ liệu, đặt lại `db_variant = "cnpg"`. Giữ CSDL quản lý
thêm một thời gian để so sánh trước khi hủy.

## 5. Lưu ý

- Đổi biến thể là **thay đổi tài nguyên chứa dữ liệu** – đi qua ba lớp chặn ở [05](05-quy-trinh-thay-doi.md) (cần gỡ bảo vệ hai bước).
- Không bao giờ chuyển production khi chưa diễn tập khôi phục thành công ở biến thể đích.
