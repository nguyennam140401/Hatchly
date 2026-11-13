# Hợp đồng: Những gì 008 cần từ mỗi môi trường (gửi tính năng 007)

`007` (hạ tầng Terraform) mới có đặc tả, chưa có kế hoạch. Tài liệu này là **yêu cầu đầu vào** của 008 để hai tính
năng khớp nhau khi `007` lập kế hoạch; nó tương ứng với danh sách đầu ra FR-024 của `007`. Cho đến khi một môi
trường đáp ứng đủ, tệp tham số của môi trường đó giữ `provisioned: false` và quy trình dừng ở "chưa có môi trường
đích" ([research.md](../research.md) R20, R23).

## 1. Đầu ra không bí mật (điền vào `ops/deploy/env/<env>.yaml`)

| Cần | Dùng cho |
|---|---|
| Địa chỉ kho ảnh riêng tư của môi trường + tên kho | đẩy ảnh, giá trị `image.repository` |
| Điểm quản trị cụm (URL + chứng thư CA) | `kubectl`, `helm` |
| Tên hai namespace: ứng dụng và migration | chart, Job migration |
| Tên miền HTTPS của `api` và của giao diện web | Ingress, kiểm tra khói |
| Tên kho tệp tĩnh + điểm cuối S3 + vùng | đưa giao diện web lên |
| Tên các Secret trong cụm: bí mật ứng dụng; bí mật `owner` | chart (`envFrom`), Job migration |
| Phiên bản chính của PostgreSQL | chọn ảnh PostgreSQL cho CSDL tạm của cổng chất lượng |
| Số bản chạy `api` / `worker` | giá trị chart |

## 2. Thứ phải tồn tại sẵn trong cụm

| Thứ | Yêu cầu |
|---|---|
| Namespace ứng dụng | chứa Secret ứng dụng (đã đồng bộ từ kho bí mật): URL CSDL vai `app`/`system`/`support`, khóa kho tệp media, bí mật ứng dụng, **`SMOKE_TOKEN`** |
| Namespace migration | chứa **duy nhất** Secret `owner`; Secret này MUST NOT có ở namespace ứng dụng |
| ServiceAccount `ci-deployer` | Role ở cả hai namespace: `deployments`, `replicasets`, `pods`, `pods/log`, `configmaps`, `services`, `ingresses`, `poddisruptionbudgets` (ứng dụng); `jobs`, `pods`, `pods/log` (migration). **Không** có `secrets`, `pods/exec`, `pods/portforward`, không có quyền cấp cụm |
| Ingress controller + chứng thư TLS | cho tên miền `api` |
| Quyền kéo ảnh | nút của cụm kéo được từ kho ảnh của chính môi trường |
| Chính sách chấp nhận (khuyến nghị mạnh) | Pod ở hai namespace chỉ được dùng ảnh từ kho ảnh của chính môi trường |

## 3. Thông tin xác thực giao cho Jenkins (SA nhập tay vào máy Jenkins, không qua kho mã)

| Thông tin | Phạm vi quyền |
|---|---|
| Tài khoản kho ảnh | đẩy / kéo / xóa trong kho ảnh của môi trường đó |
| Mã của `ci-deployer` | như mục 2; có thời hạn hoặc xoay ≤ 90 ngày |
| Khóa S3 của kho tệp tĩnh | đọc/ghi/xóa **chỉ** kho tệp tĩnh; không có quyền trên kho tệp media |
| Mã kiểm tra khói | cùng giá trị với `SMOKE_TOKEN` trong Secret ứng dụng |
| Tài khoản kiểm tra nội bộ | một tài khoản khách hàng dành riêng cho kiểm tra khói, tạo bằng lệnh vận hành; không phải khách hàng thật |

## 4. Mạng

| Luật | Phía |
|---|---|
| Điểm quản trị cụm và kho ảnh nhận kết nối từ địa chỉ của máy Jenkins | môi trường (`007`) |
| CSDL, kho tệp media, KMS **không** nhận kết nối từ máy Jenkins | môi trường (`007`) |
| Máy Jenkins nằm ở mạng riêng, không ngang hàng (peering) với mạng của hai môi trường | `infra/ci/` (008) |

## 5. Hành vi của môi trường mà quy trình dựa vào

- Test chạy các bản giả lập của Cổng nền tảng / Cổng AI / Thông báo (`007` FR-029) – kiểm tra khói không gọi ra ngoài.
- CDN phục vụ `index.html` theo `Cache-Control` của đối tượng (không ép cache dài), để con trỏ bản phát hành có
  hiệu lực ngay; nếu CDN không tôn trọng tiêu đề này thì `007` cần cung cấp lệnh xóa cache cho đúng một đường dẫn.
- Kho tệp tĩnh không bật luật vòng đời tự xóa theo tuổi trên `assets/` (008 tự dọn theo manifest).

## 6. Thứ 008 cung cấp ngược lại cho 007

- Helm chart, Job migration, tập lệnh kiểm tra khói và tập lệnh đưa giao diện lên (`ops/deploy/**`) – tài liệu
  "triển khai bằng tay" và bộ kiểm tra khói của `007` dùng chính các thứ này.
- Địa chỉ ra internet của máy Jenkins (đầu ra của `infra/ci/`) để `007` đưa vào danh sách được phép.
