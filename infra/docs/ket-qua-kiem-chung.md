# Kết quả kiểm chứng (điền khi dựng thật)

Bảng này ghi **số đo thực** khi dựng và kiểm hai môi trường. Cột "Ngày/Môi trường/Số đo" để trống cho đến khi có tài
khoản VNG Cloud (đợt P6). Mỗi dòng ghi kết quả `đạt`/`không` và ghi chú; mọi thao tác tay ngoài danh sách khởi tạo là một lỗi
của tài liệu cần sửa.

## 1. Bảng theo tiêu chí thành công

| Tiêu chí | Nội dung                                                                    | Mục tiêu                                                      | Ngày | Môi trường | Số đo | Đạt? | Ghi chú |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- | ---- | ---------- | ----- | ---- | ------- |
| SC-001   | Dựng thử nghiệm từ tài khoản trống (không tính chờ DNS/CDN)                 | ≤ 2 giờ, 0 thao tác tay ngoài danh sách                       |      |            |       |      |         |
| SC-002   | `plan` lần hai báo "Không có thay đổi" ở cả hai stack                       | 0 thay đổi                                                    |      |            |       |      |         |
| SC-003   | `pnpm infra smoke staging`                                                  | 100% mục đạt                                                  |      |            |       |      |         |
| SC-004   | Cùng tập loại tài nguyên giữa hai môi trường (trừ mail-capture)             | không khác biệt                                               |      |            |       |      |         |
| SC-005   | Phép thử cô lập hai chiều                                                   | mọi phép bị từ chối                                           |      |            |       |      |         |
| SC-006   | Ba lớp chặn lên phát hành                                                   | 11/11 dòng bảng quickstart mục 5                              |      |            |       |      |         |
| SC-007   | Mất một máy / mất bản chính CSDL                                            | gián đoạn ≤ 1 phút; đủ bản ≤ 5 phút                           |      |            |       |      |         |
| SC-008   | Diễn tập khôi phục CSDL ra môi trường tạm                                   | ≤ 1 giờ; mất dữ liệu ≤ 5 phút                                 |      |            |       |      |         |
| SC-009   | Bucket media/sao lưu không đọc được khi không xác thực                      | từ chối                                                       |      |            |       |      |         |
| SC-010   | Xóa đối tượng vẫn thấy phiên bản cũ; đủ ba luật vòng đời                    | đạt                                                           |      |            |       |      |         |
| SC-011   | Kiểm lệch phát hiện sửa tay bảng điều khiển trong 24 giờ                    | phát hiện                                                     |      |            |       |      |         |
| SC-012   | Tỷ lệ chi phí thử nghiệm / phát hành                                        | ≤ 40% khi bật suốt tháng; ≤ 15% khi bật một phần tư thời gian |      |            |       |      |         |
| SC-013   | Đổi nhà cung cấp không sửa `stacks/platform`, `smoke-deploy`, mã ứng dụng   | không sửa                                                     |      |            |       |      |         |
| SC-014   | Kích thước dựng sẵn so với tải giai đoạn 1; lên gấp 10 chỉ bằng đổi tham số | đạt                                                           |      |            |       |      |         |

### SC-012 – cách tính

Sau khi có báo giá (V10): chi phí tháng của phát hành (2 máy + CSDL 2 bản + cân bằng tải + đĩa + kho tệp) làm mẫu số.
Chi phí thử nghiệm: (a) bật suốt tháng; (b) bật một phần tư thời gian (tắt máy phần còn lại: cân bằng tải + đĩa + bucket).

### SC-014 – đối chiếu kích thước

So kích thước dựng sẵn (production: 2 máy 4 vCPU/8 GB, CSDL 1 CPU/2 GB, `max_connections = 220`) với tải giai đoạn 1
(≈ 3.000 lượt đăng/tháng, 50 GB) và khả năng **lên gấp 10** (30.000 lượt/tháng, 500 GB) chỉ bằng đổi `node_groups`,
`db_*` và `monitoring_reserved` trong `production.tfvars` – ghi tính toán ở đây.

## 2. Phép thử phục hồi (SC-007)

Chạy trên **phát hành trước khi có dữ liệu thật**. Dùng `node tooling/infra/lib/probe.mjs https://api.<miền>/healthz 600`
chạy ở một cửa sổ riêng; nó gọi mỗi giây và in "gián đoạn dài nhất".

### Phép thử A – mất một máy

1. Bật `probe` (600 giây).
2. Ở bảng điều khiển VNG Cloud (hoặc API), **xóa một máy** trong nhóm máy.
3. Quan sát `kubectl get nodes -w` và `kubectl get pods -n app -o wide`.
4. **Mong đợi:** gián đoạn dài nhất ≤ 1 phút (vì `api` ×2 trải khác máy); đủ bản trở lại ≤ 5 phút.
5. Ghi: ngày, gián đoạn đo được, thời gian đủ bản.

### Phép thử B – mất bản chính của CSDL

1. Bật `probe`.
2. `kubectl get cluster pg -n database -o jsonpath='{.status.currentPrimary}'` để biết bản chính.
3. `kubectl delete pod <bản chính> -n database`.
4. **Mong đợi:** bản dự phòng lên làm chính; ứng dụng nối lại qua `pg-rw` ≤ 5 phút, **không đổi cấu hình**.
5. Ghi: thời gian chuyển, có lỗi ứng dụng không.

| Phép thử               | Ngày | Gián đoạn dài nhất | Đủ bản sau | Đạt? |
| ---------------------- | ---- | ------------------ | ---------- | ---- |
| A – mất một máy        |      |                    |            |      |
| B – mất bản chính CSDL |      |                    |            |      |

## 3. Phép thử cô lập còn phải làm tay (SC-005)

`pnpm infra smoke production --infra-only` tự thử: khóa S3 chéo, thấy project chéo, so tập tài nguyên. Hai phép còn làm tay:

1. **Mạng:** từ một pod tạm ở thử nghiệm (`kubectl run tmp --rm -it --image=busybox -- sh`) thử kết nối tới địa chỉ
   nội bộ của CSDL phát hành → phải **không tới được** (hai mạng khác dải, không nối với nhau).
2. **KMS chéo:** nếu API cho phép (V4), dùng tài khoản `app-staging` gọi khóa của production → phải bị từ chối.

## 4. Ghi chép dựng thật

| Hạng mục                                  | Ngày | Người làm | Thời gian | Thao tác tay ngoài danh sách | Ghi chú |
| ----------------------------------------- | ---- | --------- | --------- | ---------------------------- | ------- |
| Dựng thử nghiệm (`pnpm infra up staging`) |      |           |           |                              |         |
| Bật lại thử nghiệm (`power staging on`)   |      |           |           |                              |         |
| Dựng phát hành                            |      |           |           |                              |         |
| Diễn tập khôi phục lần 1                  |      |           |           |                              |         |

## 5. Rà hiến pháp (T120, 2026-11-14)

Rà theo chín nguyên tắc, trọng tâm VII, IX, I. Kết luận: **tuân thủ**, kèm ba rủi ro còn lại cần biết.

| Nguyên tắc               | Kết luận           | Bằng chứng                                                                                                                                                                                   |
| ------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I – cô lập               | Đạt                | `api-secrets` không có chuỗi kết nối `owner`/`admin`/`system`; mỗi ServiceAccount chỉ `get` một Secret (`handoff.spec.ts`, `secrets.spec.ts`, `platform.tftest.hcl`, `smoke` 9 phép `can-i`) |
| VII – bí mật và dữ liệu  | Đạt, có rủi ro     | Terraform không tạo/giữ bí mật ứng dụng (kiểm bằng grep ở `provider-module.spec.ts`); không đầu ra `sensitive`; CLI không in giá trị; dữ liệu ở vùng trong nước (`allowed_regions`)          |
| IX – đơn giản, chuẩn mở  | Đạt                | Terraform, provider, biểu đồ Helm, ảnh theo digest đều cố định phiên bản; thành phần mới đều có ADR-11; không cache/broker mới                                                               |
| II, III, IV, V, VI, VIII | Không bị ảnh hưởng | Tính năng không đổi mã nghiệp vụ; chỉ thêm `STAGING_ALLOW_FAKES` (ngoại lệ hẹp ở thử nghiệm, có kiểm thử)                                                                                    |

### Rủi ro còn lại (ghi để chủ dự án quyết)

1. **Tệp bản xem trước chứa biến `sensitive`.** Khóa tài khoản dịch vụ đi vào Terraform qua `TF_VAR_…` (provider VNG không đọc biến
   môi trường). Tệp `infra/.plans/<env>/cloud.tfplan` có thể chứa giá trị đó. Giảm nhẹ: chỉ nằm trên máy người vận hành, bị
   `.gitignore`, hết hạn sau 24 giờ và bị xóa sau khi áp dụng; không được commit hay đưa lên GitHub. Nếu muốn loại bỏ hẳn: xin nhà
   cung cấp đọc khóa từ biến môi trường, hoặc dùng token ngắn hạn.
2. **Trạng thái stack `cloud` có thể chứa kubeconfig.** `vngcloud_vks_cluster.config` do provider ghi vào trạng thái. Bucket
   trạng thái riêng tư, có lưu phiên bản, mã hóa (C7). Không phải đầu ra. Nếu kubeconfig chứa chứng chỉ khách có thời hạn dài,
   cân nhắc xoay cụm định kỳ.
3. **V2, V4, V7, V9 chưa trả lời.** V2/V4/V9 **chặn** đưa dữ liệu thật vào phát hành (precondition đĩa mã hóa ở `outputs.tf` của
   stack platform sẽ dừng `plan production` cho đến khi V9 đạt). V7 đã chấp nhận rủi ro (xem 06 mục 5).

## 6. Đối chiếu "Khi nào coi là xong" (T121)

| Mục                                        | Trạng thái                                                                                                               | Ghi chú                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Mục 1 đạt trên máy và trong `infra-static` | **Đạt trên máy** (`pnpm infra check` 7/7, `pnpm verify`); workflow `infra-static.yml` đã viết, **chưa chạy trên GitHub** | Chạy ở lần đẩy đầu tiên                                                    |
| Mục 2, 3 trên thử nghiệm thật              | Chờ P6                                                                                                                   | T071–T074                                                                  |
| Mục 4 trên phát hành                       | Chờ P6                                                                                                                   | T082–T084                                                                  |
| Mục 5 + `infra-drift` 2 ngày liên tiếp     | Mã và kiểm thử đạt; chạy thật chờ P6                                                                                     | T101                                                                       |
| Mục 6 diễn tập khôi phục                   | Mã và kiểm thử đạt; chạy thật chờ P6                                                                                     | T110, T111                                                                 |
| Mọi mục "Chặn" của P6 có câu trả lời đạt   | **Chưa**                                                                                                                 | V2, V4, V9 (và V5 có điều kiện) — trước khi đưa dữ liệu thật vào phát hành |
