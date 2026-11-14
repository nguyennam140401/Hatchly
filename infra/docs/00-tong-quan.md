# 00 – Tổng quan hạ tầng

Tài liệu này dành cho người **chưa quen vận hành đám mây**. Đọc hết một lần, sau đó tra cứu theo bản đồ ở cuối.

## 1. Bức tranh chung

Ứng dụng chạy ở **hai môi trường tách biệt**:

|         | Thử nghiệm (`staging`)                                       | Phát hành (`production`)                    |
| ------- | ------------------------------------------------------------ | ------------------------------------------- |
| Dùng để | Thử mọi thay đổi trước, chạy bộ kiểm tra khói, thử khôi phục | Phục vụ khách hàng thật                     |
| Máy     | 1 máy, tắt được khi không dùng                               | 2 máy, luôn bật                             |
| CSDL    | 1 bản, giữ sao lưu 3 ngày                                    | 2 bản (chịu mất 1 máy), giữ sao lưu 30 ngày |
| Dữ liệu | Dữ liệu thử                                                  | Dữ liệu khách hàng                          |

Hai môi trường **không dùng chung gì**: mỗi bên một project, một mạng, một cụm, một kho tệp, bộ khóa riêng. Nhờ vậy
thao tác sai ở thử nghiệm không thể chạm dữ liệu thật.

Mỗi môi trường được dựng bằng **hai lớp mã Terraform** (gọi là _stack_):

```
 stack cloud   ──►  mạng, cụm Kubernetes (VKS), cân bằng tải, kho tệp S3     (chỉ nhà cung cấp VNG Cloud)
      │
      ▼  (chỉ đọc đầu ra theo hợp đồng cố định)
 stack platform ──►  lối vào HTTPS, chứng chỉ, CSDL PostgreSQL, chính sách mạng, quyền (chuẩn mở Kubernetes)
```

**Lớp nhà cung cấp** (`infra/modules/provider-vngcloud`) là nơi **duy nhất** biết đến VNG Cloud. Muốn đổi nhà cung cấp
chỉ viết module mới đúng hợp đồng (`specs/007-…/contracts/provider-layer.md`); phần còn lại không đổi.

Hai môi trường chạy **cùng một mã**, chỉ khác tệp tham số `infra/envs/<env>.tfvars`.

## 2. Hai nguyên tắc phải nhớ

1. **Không gọi `terraform` trực tiếp với môi trường thật.** Luôn dùng `pnpm infra <lệnh> <env>`. Công cụ này kiểm đúng
   môi trường, đúng bản xem trước, và chặn thao tác có thể làm mất dữ liệu.
2. **Terraform không giữ bí mật.** Mật khẩu, khóa truy cập không nằm trong mã, tệp tham số hay trạng thái Terraform. Chúng
   được tạo trực tiếp trong cụm bằng `pnpm infra secrets …` (xem [06](06-bi-mat-va-khoa.md)).

## 3. Việc gì làm bằng lệnh nào

| Tôi muốn…                                      | Lệnh                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| Kiểm tra mã hạ tầng (không cần tài khoản)      | `pnpm infra check`                                     |
| Kiểm tra mình đã làm đủ các việc tay ban đầu   | `pnpm infra bootstrap-check staging`                   |
| Dựng môi trường lần đầu                        | `pnpm infra up staging`                                |
| Xem trước thay đổi rồi áp dụng                 | `pnpm infra plan staging` → `pnpm infra apply staging` |
| Xem địa chỉ, tên bí mật, bản ghi DNS cần tạo   | `pnpm infra outputs staging`                           |
| Kiểm tra DNS và chứng chỉ                      | `pnpm infra dns-check staging`                         |
| Kiểm tra ứng dụng chạy đúng sau khi triển khai | `pnpm infra smoke staging`                             |
| Tắt/bật máy thử nghiệm để tiết kiệm            | `pnpm infra power staging off` / `on`                  |
| Tạo, nhập, xem tên, xoay bí mật                | `pnpm infra secrets init                               | set | list | rotate …` |

## 4. Mã thoát của `pnpm infra`

| Mã  | Nghĩa                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 0   | Thành công / không lệch / không thay đổi                                                                      |
| 1   | Lỗi thực thi hoặc kiểm tra không đạt                                                                          |
| 2   | Có lệch (`drift`) / có thay đổi (`plan`)                                                                      |
| 3   | Bị lớp chặn từ chối (sai môi trường, thiếu bản xem trước, có thể mất dữ liệu…)                                |
| 4   | Thiếu điều kiện khởi tạo (chưa có hồ sơ chứng thực, chưa làm xong danh sách khởi tạo, DNS/chứng chỉ chưa đạt) |

Mỗi lần bị chặn, công cụ in **việc cần làm tiếp**.

## 5. Thuật ngữ

| Từ                              | Nghĩa                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| Terraform                       | Công cụ mô tả hạ tầng bằng tệp mã; đọc mã rồi tạo/sửa tài nguyên cho khớp |
| Stack                           | Một nhóm mã Terraform chạy cùng nhau (ở đây: `cloud`, `platform`)         |
| Kế hoạch / bản xem trước (plan) | Danh sách "sẽ tạo/sửa/xóa gì", xem trước khi áp dụng                      |
| Trạng thái (state)              | Bản ghi Terraform nhớ nó đã tạo gì; lưu ở bucket riêng                    |
| Kubernetes / cụm                | Hệ thống chạy các container ứng dụng; VKS là bản do VNG Cloud quản lý     |
| Secret                          | Đối tượng Kubernetes chứa mật khẩu/khóa, chỉ ứng dụng tương ứng đọc được  |
| Lối vào (Ingress)               | Cửa HTTPS duy nhất từ internet vào ứng dụng                               |
| Lệch (drift)                    | Hạ tầng thực tế khác với mã (ví dụ có người sửa tay trên bảng điều khiển) |
| Digest                          | Dấu vân tay của một ảnh container (`sha256:…`); chạy đúng ảnh đã kiểm     |

## 6. Bản đồ tài liệu

| Tài liệu                                                                      | Nội dung                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| [01 – Khởi tạo lần đầu](01-khoi-tao-lan-dau.md)                               | Các việc làm tay một lần trên bảng điều khiển |
| [02 – Dựng môi trường](02-dung-moi-truong.md)                                 | Chuẩn bị máy, điền tham số, `pnpm infra up`   |
| [03 – DNS và chứng chỉ](03-dns-va-chung-chi.md)                               | Tạo bản ghi DNS, CDN, xử lý chứng chỉ         |
| [04 – Triển khai ảnh và kiểm tra khói](04-trien-khai-anh-va-kiem-tra-khoi.md) | Đẩy ảnh, áp kê khai tạm, `smoke`              |
| [06 – Bí mật và khóa](06-bi-mat-va-khoa.md)                                   | Bảng bí mật, nhập, xoay                       |
| [09 – Tắt/bật thử nghiệm](09-tat-bat-thu-nghiem.md)                           | Tiết kiệm chi phí                             |
| `p6-cau-hoi-nha-cung-cap.md`                                                  | Thư hỏi VNG Cloud (14 câu)                    |

Các tài liệu 05, 07, 08, 10, 11 (kiểm lệch, phát hành lên production, sao lưu và khôi phục, sự cố, chi phí) được thêm ở
các đợt sau của cùng tính năng.
