# 09 – Tắt/bật môi trường thử nghiệm

Môi trường thử nghiệm chỉ cần chạy khi bạn đang dùng. **Tắt máy** khi không dùng để tiết kiệm; địa chỉ và dữ liệu giữ nguyên.
Chỉ áp dụng cho `staging` — production luôn bật.

```
pnpm infra power staging off     # tắt
pnpm infra power staging on      # bật lại
```

## 1. Thứ gì bị gỡ, thứ gì được giữ (bảng R11)

| Thành phần                              | Khi tắt                                        | Vì sao                                         |
| --------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Máy của cụm (nhóm máy)                  | **Gỡ** (về 0)                                  | Đây là phần tính tiền nhiều nhất               |
| Cụm VKS (phần điều khiển)               | Giữ                                            | Phần điều khiển miễn phí; giữ để bật lại nhanh |
| Cân bằng tải + **địa chỉ IP công khai** | Giữ                                            | Địa chỉ **không đổi**, DNS không phải sửa      |
| Bucket (media, sao lưu, trạng thái)     | Giữ                                            | Dữ liệu                                        |
| Đĩa CSDL                                | Giữ (mặc định `staging_keep_db_volume = true`) | Dữ liệu thử còn nguyên                         |
| Pod ứng dụng                            | Không chạy (không có máy)                      |                                                |

**Chi phí khi tắt** ≈ cân bằng tải + đĩa + bucket. Con số thực ghi vào bảng kết quả (V10, SC-012).

## 2. Bật lại

`pnpm infra power staging on` làm theo thứ tự: tạo lại máy (~10–15 phút) → lấy kubeconfig → áp nền tảng → chờ `api`,
`worker`, CSDL sẵn sàng → kiểm tra DNS. Tổng mục tiêu **≤ 60 phút**; quá thì in cảnh báo.

Sau khi bật, chạy `pnpm infra smoke staging` để chắc mọi thứ lên đủ.

## 3. `power_lock` – khóa không cho tắt

Trong lúc **Meta xét duyệt** ứng dụng, họ cần gọi được môi trường thử nghiệm bất cứ lúc nào. Đặt trong `staging.tfvars`:

```
power_lock = true
```

Khi đó `power staging off` **bị từ chối** (mã 3) kèm lý do. Hết xét duyệt thì đặt lại `false`.

## 4. `staging_keep_db_volume`

| Giá trị           | Hành vi khi tắt                                      | Khi bật                                           |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `true` (mặc định) | Giữ đĩa CSDL                                         | Dữ liệu thử còn nguyên                            |
| `false`           | Gỡ **cả đĩa CSDL** (tiết kiệm thêm, dữ liệu thử mất) | Dựng lại CSDL trống, chạy migration + dữ liệu mẫu |

## 5. Cách công cụ nhớ trạng thái

Trạng thái "đang tắt/bật" lưu ở `runtime/power.json` trong bucket trạng thái. `pnpm infra plan/apply` đọc nó để không vô
tình bật máy lại. Nếu máy đang tắt, bước `platform` của `plan` được bỏ qua (cụm không có máy để chạy).

## 6. Sau khi bật cần làm

1. `pnpm infra dns-check staging` (DNS không đổi nên phải đạt ngay).
2. `pnpm infra smoke staging`.
3. Nếu thiếu `Secret` (do `keep_db_volume = false`): `pnpm infra secrets init staging`.
