# 05 – Quy trình thay đổi hạ tầng

Một mình bạn vừa viết vừa duyệt thay đổi, nên **công cụ** đóng vai người duyệt: ba lớp chặn không cho thay đổi nào lên
phát hành nếu chưa qua thử nghiệm, chưa có bản xem trước đã lưu, hoặc có thể làm mất dữ liệu.

## 1. Quy trình chuẩn

```
sửa mã/tham số → commit → pnpm infra check
   → pnpm infra plan staging → đọc bản xem trước → pnpm infra apply staging → kiểm (smoke, dns-check)
   → pnpm infra plan production → đọc → pnpm infra apply production (gõ lại "production")
```

Lý do commit trước: công cụ từ chối chạy khi `infra/` hoặc `tooling/infra/` còn tệp chưa commit (để mọi lần áp dụng truy
được về một commit).

## 2. Ba lớp chặn (chỉ production, trừ khi nói khác)

| Lớp                                      | Chặn khi                                                                                   | Thông điệp                                                                                          | Xử lý                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------- |
| **(a) Đã chạy ở thử nghiệm**             | Chưa có bản ghi áp dụng của **cả hai stack** ở thử nghiệm với đúng dấu định nghĩa hiện tại | "Thay đổi này chưa áp dụng thành công ở thử nghiệm (dấu …). Chạy `pnpm infra apply staging` trước." | Áp dụng ở thử nghiệm trước |
| **(b) Đúng bản đã lưu** (mọi môi trường) | Không có bản xem trước; mã hoặc tham số đã đổi sau khi xem; quá 24 giờ                     | "Mã hoặc tham số đã đổi sau khi xem trước. Chạy lại `pnpm infra plan production`."                  | Lập lại bản xem trước      |
| **(c) Tài nguyên chứa dữ liệu**          | Bản xem trước **xóa/thay thế** bucket, cụm CSDL, đĩa, không gian tên `database`            | "Bản xem trước sẽ XÓA/THAY THẾ: …"                                                                  | Xem mục 4                  |

Ở **thử nghiệm**: lớp (a) không áp dụng; lớp (c) chỉ cảnh báo và hỏi `y/N`.

Dấu định nghĩa (`definitionHash`) tính trên `infra/modules/**` và `infra/stacks/**` (kể cả khóa provider). Đổi tài liệu, kê
khai tạm, kiểm thử hay tệp tham số **không** đổi dấu này; tệp tham số có dấu riêng (`paramsHash`) cho lớp (b).

### Giới hạn đã biết

Thay đổi **chỉ ở `production.tfvars`** (ví dụ tăng `db_storage_gb`) không đổi dấu định nghĩa nên **qua lớp (a)** mà chưa
được thử. Hãy tự thử tham số tương đương ở thử nghiệm trước (research R13).

## 3. Bản ghi áp dụng

Sau mỗi lần áp dụng thành công, công cụ ghi một bản ghi chỉ-thêm vào bucket trạng thái (`records/applied/…`): thời điểm,
commit, dấu, người chạy, tóm tắt, có xác nhận mất dữ liệu không. Xem: `pnpm infra records production --last 10`.

## 4. Xóa/thay thế tài nguyên chứa dữ liệu (hai bước)

Công cụ cố ý khó làm việc này. Muốn thật sự xóa/thay thế (ví dụ đổi tên bucket media):

1. **Bước 1 – gỡ bảo vệ:** một thay đổi **riêng** đặt `deletion_protection = false` trong `production.tfvars`. Qua thử
   nghiệm rồi `plan`/`apply production`. Bản ghi áp dụng ghi nhận "đã gỡ bảo vệ".
2. **Bước 2 – xác nhận:** thay đổi xóa/thay thế; `pnpm infra plan production` in `!! XÓA/THAY THẾ …`; sau đó
   `pnpm infra apply production --confirm-data-loss` và **gõ lại `production`**.
3. Đặt lại `deletion_protection = true` ngay sau đó.

Thiếu một trong ba (bản ghi gỡ bảo vệ, cờ, gõ lại tên) là bị chặn (mã 3).

## 5. Nâng phiên bản Kubernetes / biểu đồ

Đổi `kubernetes_version` hoặc `chart_versions` **đồng thời ở cả hai** tệp tham số (hai tệp phải giống nhau, `check` báo
lỗi nếu lệch). Thử ở thử nghiệm, chạy `pnpm infra smoke staging`, rồi mới lên production. Đọc kỹ ghi chú phát hành của
biểu đồ (đặc biệt cert-manager và CloudNativePG).

## 6. Kiểm tra lệch

- **Tự động, hằng ngày (GitHub):** workflow `infra-drift` chạy `pnpm infra drift <env> --stack cloud`. Chỉ đọc. Có lệch →
  mở issue `infra-drift:<env>`; hết lệch → tự đóng.
- **Giới hạn:** quy trình trên GitHub **chỉ kiểm stack `cloud`** (mạng, cụm, cân bằng tải, bucket) vì API cụm chỉ mở cho
  `admin_cidrs`. Lệch **trong cụm** (ai đó `kubectl edit`) chỉ lộ ra ở lần `plan` kế tiếp hoặc khi chạy tay
  `pnpm infra drift <env>` trên máy bạn — **khuyến nghị chạy hằng tuần**, và 24 giờ không phải là mức phát hiện cho phần này.
- Xử lý issue lệch: xem [08](08-xu-ly-su-co.md).

## 7. Mã thoát nhắc nhanh

`0` đạt · `1` lỗi · `2` có lệch/thay đổi · `3` bị lớp chặn · `4` thiếu điều kiện khởi tạo.
