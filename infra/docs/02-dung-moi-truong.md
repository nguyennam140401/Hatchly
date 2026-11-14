# 02 – Dựng môi trường

Sau khi xong [01](01-khoi-tao-lan-dau.md), tài liệu này đưa bạn tới một môi trường chạy được ở mức hạ tầng.

## 1. Chuẩn bị máy (Windows)

| Công cụ   | Phiên bản                                           | Cài                                   |
| --------- | --------------------------------------------------- | ------------------------------------- |
| Node.js   | 24.x                                                | nodejs.org                            |
| pnpm      | theo `package.json` (`packageManager`)              | `corepack enable`                     |
| Terraform | **đúng** phiên bản trong `infra/.terraform-version` | tải bản `windows_amd64`, đặt vào PATH |
| tflint    | phiên bản ghi ở đầu `infra/.tflint.hcl`             | tải từ trang phát hành của tflint     |
| kubectl   | bản gần nhất                                        | docs của Kubernetes                   |
| Docker    | bản gần nhất                                        | để dựng ảnh ứng dụng                  |

Kiểm: `pnpm infra check` — phải `ĐẠT: 7/7`. (Thiếu `terraform`/`tflint` thì in `SKIPPED` và bỏ qua phần cần chúng.)

## 2. Điền `infra/envs/staging.tfvars`

Mỗi khóa là một quyết định; **khóa nào ghi `TODO-P6` là chưa biết**. Các khóa "khác biệt được phép" so với production:

| Khóa                                              | Ý nghĩa                                                         | Gợi ý thử nghiệm               |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| `environment`                                     | Tên môi trường                                                  | `staging`                      |
| `project_id`                                      | Project ở nhà cung cấp                                          | từ C1                          |
| `network_cidr`, `subnet_cidr`                     | Dải mạng, **không trùng** production                            | `10.20.0.0/16`, `10.20.1.0/24` |
| `base_domain`                                     | Tên miền gốc của môi trường                                     | `staging.<tên miền của bạn>`   |
| `cdn_cname_target`                                | Tên miền CDN cấp cho `app.<base_domain>`                        | từ C9                          |
| `node_groups`                                     | Nhóm máy: `flavor` (mã của VKS), `count`, `vcpu`, `disk_gb`     | 1 × 4 vCPU/8 GB, đĩa 50 GB     |
| `staging_max_vcpu`                                | Trần tổng vCPU (chặn lỡ tay tăng chi phí)                       | `8`                            |
| `db_instances`, `db_storage_gb`, `db_resources`   | CSDL                                                            | 1 bản, 10 GB, 0,5 CPU/1 GB     |
| `db_backup_retention_days`                        | Số ngày giữ sao lưu                                             | `3`                            |
| `deletion_protection`                             | Chống xóa nhầm dữ liệu                                          | `false` ở thử nghiệm           |
| `admin_cidrs`                                     | **Địa chỉ IP của bạn** được gọi API cụm. Không được `0.0.0.0/0` | `["x.x.x.x/32"]`               |
| `kms_key_id`                                      | Khóa KMS (C8)                                                   | từ C8                          |
| `mail_capture_enabled`                            | Bắt thư thử bằng Mailpit                                        | `true`                         |
| `search_indexing`                                 | Cho Google lập chỉ mục                                          | **luôn `false`** ở thử nghiệm  |
| `powered`, `power_lock`, `staging_keep_db_volume` | Tắt/bật máy ([09](09-tat-bat-thu-nghiem.md))                    | `true`, `false`, `true`        |

Các khóa "phải giống production" (`name_prefix`, `region`, `kubernetes_version`, `postgres_major`, `chart_versions`, …)
**không tự sửa riêng một bên** — `pnpm infra check` sẽ báo lỗi nếu hai tệp lệch nhau.

Khóa thêm vì nhà cung cấp đòi: `node_ssh_public_key` (khóa **công khai**; cổng 22 vẫn đóng), `lb_package_id`,
`object_storage_endpoint`, `storage_class`, `storage_class_encrypted`.

## 3. Dựng: `pnpm infra up staging`

Chạy từng bước, in rõ bạn đang ở đâu:

| Bước | Việc                                        | Mong đợi                                                                                 |
| ---- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1    | `bootstrap-check`                           | mọi mục `[đạt]`/`[tự xác nhận]`/`[kiểm sau khi dựng]`; nếu còn `[thiếu]` thì dừng (mã 4) |
| 2    | Stack `cloud`: xem trước → áp dụng          | mạng, cụm, cân bằng tải, bucket (~15–25 phút, chủ yếu chờ cụm)                           |
| 3    | Lấy kubeconfig                              | ghi `infra/.credentials/staging.kubeconfig`                                              |
| 4    | Stack `platform`                            | lối vào, cert-manager, CloudNativePG, chính sách mạng, quyền                             |
| 5    | `secrets init`                              | tạo các Secret tự sinh                                                                   |
| 6    | In bản ghi DNS và các lệnh nhập tay còn lại | làm tiếp theo [03](03-dns-va-chung-chi.md)                                               |

Mục tiêu tổng thời gian: **≤ 2 giờ** (SC-001).

### Chạy lại khi lỗi giữa chừng

Cứ chạy lại `pnpm infra up staging`. Bước nào đã xong thì "Không có thay đổi" và bỏ qua; **không tạo tài nguyên trùng**.
Ngắt bằng Ctrl+C cũng an toàn: trạng thái được giữ, chạy lại tiếp tục.

## 4. Đọc bản xem trước

```
[cloud] 12 tạo · 0 sửa · 0 thay thế · 0 xóa
   tạo  module.provider.vngcloud_vserver_network.this
   …
```

- **tạo / sửa**: bình thường.
- **`!! THAY THẾ` / `!! XÓA`**: nguy hiểm — tài nguyên sẽ bị hủy rồi dựng lại. Nếu là tài nguyên chứa dữ liệu (đĩa, bucket)
  hãy dừng và đọc kỹ; ở production công cụ sẽ chặn (xem tài liệu 07).
- **Không có thay đổi**: hạ tầng khớp mã. Đây là dấu hiệu khỏe mạnh (SC-002).

Xem lại bất cứ lúc nào: `pnpm infra plan staging` rồi `pnpm infra apply staging` — chỉ áp dụng **đúng** bản đã xem.

## 5. Không thấy thay đổi nào mà nghi ngờ?

- `pnpm infra outputs staging`: địa chỉ cụm, IP công khai, bản ghi DNS cần tạo.
- `pnpm infra secrets list staging`: Secret nào đã có (chỉ tên, không giá trị).
