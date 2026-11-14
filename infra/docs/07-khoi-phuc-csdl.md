# 07 – Khôi phục CSDL

Mục tiêu hiến pháp: **mất dữ liệu ≤ 5 phút, khôi phục ≤ 1 giờ**, và khôi phục phải được **diễn tập mỗi quý** ra môi trường
riêng, có đo thời gian. Sao lưu chưa từng khôi phục thử thì chưa phải sao lưu.

## 1. Cách sao lưu hoạt động

CloudNativePG lưu **nhật ký giao dịch (WAL) liên tục** lên bucket sao lưu (`archive_timeout = 5min` → mất tối đa ~5 phút) và
chụp sao lưu đầy đủ mỗi ngày lúc 02:00 UTC+7. Giữ 3 ngày (thử nghiệm) / 30 ngày (phát hành). Khôi phục về **bất kỳ thời điểm
nào** trong cửa sổ giữ.

## 2. Diễn tập mỗi quý: `pnpm infra drill`

Diễn tập dựng một **môi trường tạm cô lập** (không cân bằng tải, không bucket mới, chặn đi ra ngoài, không thư, không nền
tảng mạng xã hội/AI), khôi phục CSDL về thời điểm bạn chọn, đo thời gian, kiểm cô lập, ghi bản ghi, rồi **hủy sạch**.

Chuẩn bị một lần: tài khoản `drill-<env>` chỉ đọc bucket sao lưu (mục C12, mục 5 dưới) và `infra/.credentials/drill-<env>.env`.

```
# 1. (tùy chọn) ghi một dòng đánh dấu vào CSDL nguồn rồi chờ ≥ 10 phút (để nằm trong sao lưu)
# 2. chọn thời điểm đích: một lúc SAU dòng đánh dấu, trong cửa sổ giữ sao lưu
pnpm infra drill start --from production --target-time 2026-12-01T02:00:00Z
#    → dựng môi trường tạm; nếu chưa có kubeconfig của cụm "drill", tải từ bảng điều khiển VKS vào
#      infra/.credentials/drill.kubeconfig rồi chạy lại cùng lệnh; nhập khóa chỉ đọc vào Secret pg-backup-s3
pnpm infra drill verify --marker "select exists (select 1 from <bảng> where <điều kiện dòng đánh dấu>)"
#    → chờ CSDL lên, chạy truy vấn đánh dấu, đo thời gian, chạy các phép thử cô lập, ghi bản ghi
pnpm infra drill destroy
#    → hủy platform rồi cloud, kiểm không còn tài nguyên environment=drill
pnpm infra records production --last 1
```

### Chọn `--target-time`

Thời điểm **sau** lúc bạn ghi dòng đánh dấu và **trước** hiện tại, trong cửa sổ giữ sao lưu. Công cụ từ chối thời điểm ở
tương lai hoặc ngoài cửa sổ giữ. Khi diễn tập thật: chọn "khoảng 1 giờ trước" để mô phỏng sự cố.

### Đọc bản ghi diễn tập

| Trường            | Ý nghĩa                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `durationSeconds` | Từ lúc bắt đầu tới khi truy vấn được (≤ 3600 mới đạt)                               |
| `dataLossSeconds` | Khoảng cách giữa thời điểm đích và thời điểm thực sự khôi phục được (≤ 300 mới đạt) |
| `markerFound`     | Dòng đánh dấu có trong CSDL khôi phục                                               |
| `result`          | `pass` ⇔ cả ba điều kiện trên đạt **và** mọi phép thử cô lập đạt                    |

### Phép thử cô lập (phải đều "bị chặn")

Không kết nối được SMTP ra ngoài · không ra được internet · không gọi được nền tảng mạng xã hội/AI · không kết nối được tới
CSDL đang chạy của môi trường nguồn (`pg-rw` – FR-028). Một phép "được phép" là lỗi nghiêm trọng.

### Lịch nhắc

Đặt nhắc **mỗi quý** (tháng 3, 6, 9, 12). Diễn tập đầu tiên của phát hành làm **trước ngày ra mắt**.

## 3. Khôi phục thật khi có sự cố

1. **Xác định:** mất toàn bộ CSDL hay chỉ dữ liệu bị xóa/hỏng nhầm? Ghi lại thời điểm "trước khi hỏng".
2. **Quyết định:**
   - _Chỉ dữ liệu sai, cụm còn tốt_ → khôi phục ra **một Cluster mới** bên cạnh (tên khác), kiểm dữ liệu, rồi xuất các dòng
     cần thiết về CSDL chính. An toàn nhất, không đụng bản đang chạy.
   - _Mất cả CSDL / hỏng nặng_ → khôi phục thành Cluster **thay thế** `pg`.
3. **CloudNativePG:** dùng `bootstrap.recovery` với `source` trỏ `ObjectStore` đọc bucket sao lưu và
   `recoveryTarget.targetTime` = thời điểm "trước khi hỏng" (xem biểu đồ `infra/modules/database-cnpg/charts/pg-cluster`,
   `mode: recovery`).
4. **Trỏ ứng dụng lại:** giữ tên dịch vụ `pg-rw` nên ứng dụng không đổi cấu hình; nếu dùng Cluster tên khác, đổi `Service`.
5. **Kiểm sau khôi phục:** `pnpm infra smoke <env>` (mục ghi/đọc CSDL); kiểm số dòng bảng quan trọng; bật lại sao lưu
   (Cluster mới phải có `ScheduledBackup` và lưu WAL); chạy `pnpm infra plan <env>` để biết lệch với mã.
6. Ghi sự cố và thời gian thực tế (so với mục tiêu ≤ 1 giờ) vào nhật ký sự cố.

## 4. Khôi phục tệp media đã xóa trong 7 ngày

Bucket media bật **lưu phiên bản** và giữ phiên bản cũ 7 ngày (SC-010). Tệp xóa nhầm chỉ có "dấu xóa" che phiên bản cũ:
liệt kê phiên bản của khóa (`ListObjectVersions`), xóa **dấu xóa** (delete marker) là tệp hiện lại. Quá 7 ngày không khôi phục được.

## 5. Tài khoản `drill-production` (C12) – vì sao chỉ đọc

Tài khoản này đọc bucket sao lưu phát hành để diễn tập. Nó **chỉ đọc** (ghi/xóa bị từ chối), **không** đọc bucket media, không
dùng KMS: lỡ lộ khóa thì kẻ xấu cũng không sửa/xóa được sao lưu thật. Kiểm bằng `pnpm infra bootstrap-check production`.

## 6. Cấm sao chép dữ liệu phát hành sang thử nghiệm

Dữ liệu khách hàng thật **không** được chép sang thử nghiệm (nguyên tắc VII, Luật BVDLCN). Môi trường diễn tập là ngoại lệ
duy nhất vì nó cô lập hoàn toàn (không ra internet, không địa chỉ công khai) và **bị hủy** ngay sau khi đo.
