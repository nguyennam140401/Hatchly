# 03 – DNS và chứng chỉ

Sau `pnpm infra up`, hạ tầng đã có **địa chỉ IP công khai** cho lối vào, nhưng **tên miền chưa trỏ về**. Việc này làm tay ở
nơi bạn đăng ký tên miền, vì Terraform không quản lý DNS của bạn.

## 1. Cần tạo bản ghi nào

Chạy `pnpm infra outputs staging`, mục **"Bản ghi DNS cần tạo"**. Có ba bản ghi:

| Tên                        | Loại    | Giá trị                               | Mục đích                       |
| -------------------------- | ------- | ------------------------------------- | ------------------------------ |
| `api.<base_domain>`        | `A`     | `ingress.public_ip`                   | API ứng dụng                   |
| `origin-app.<base_domain>` | `A`     | `ingress.public_ip`                   | **Nguồn** để CDN lấy giao diện |
| `app.<base_domain>`        | `CNAME` | tên miền CDN cấp (`cdn_cname_target`) | Địa chỉ khách hàng dùng        |

Địa chỉ IP **không đổi** khi tắt/bật máy thử nghiệm ([09](09-tat-bat-thu-nghiem.md)), nên làm một lần là đủ.

## 2. Tạo điểm phân phối CDN (mục C9)

1. Bảng điều khiển vCDN → tạo điểm phân phối mới.
2. **Nguồn (origin)**: HTTP(S) tới `origin-app.<base_domain>`.
3. **Tên miền**: `app.<base_domain>`.
4. Bật "tôn trọng tiêu đề cache của nguồn" (ảnh nginx đã đặt `/assets/` cache 1 năm, `index.html` không cache).
5. Bắt buộc HTTPS.
6. Lấy **tên miền CDN cấp** (dạng `xxxx.cdn…`), điền vào `cdn_cname_target` của `staging.tfvars`, chạy lại
   `pnpm infra plan/apply` rồi tạo bản ghi `CNAME` ở trên.

### Chứng chỉ cho tên miền trên CDN

Tên `app.<base_domain>` cần chứng chỉ **trên CDN**. Thử lần lượt (theo research R7):

1. CDN tự cấp/gia hạn chứng chỉ miễn phí cho tên miền riêng (câu V3) – dễ nhất, nếu có.
2. Tải chứng chỉ Let's Encrypt lên CDN (cấp bằng cert-manager ở cụm cho `origin-app`, hoặc `certbot` tay) – nhớ gia hạn 90 ngày.
3. Dùng chứng chỉ mua từ nhà cấp – gia hạn hằng năm.

Chọn phương án nào, ghi lại vào bảng "Kết quả kiểm chứng".

## 3. Kiểm tra: `pnpm infra dns-check staging`

```
[đạt] A api.staging.example.vn → 203.0.113.50
[thiếu] CNAME app.staging.example.vn (cần xxxx.cdn…)
[sai: đang là 198.51.100.7, cần 203.0.113.50] A origin-app.staging.example.vn
```

- `[đạt]`: đúng.
- `[thiếu]`: chưa tạo bản ghi (hoặc chưa lan truyền).
- `[sai: đang là …]`: tạo nhưng giá trị khác — sửa lại.

DNS có thể mất **vài phút đến vài giờ** để lan truyền. Chạy lại cho tới khi đạt. Sau khi DNS đạt, lệnh tiếp tục kiểm
**chứng chỉ TLS** của từng tên (hợp lệ, đúng tên, còn hạn > 14 ngày). Chưa đạt → mã thoát 4.

## 4. Chứng chỉ chưa cấp được – làm gì?

Chứng chỉ của `api` và `origin-app` do cert-manager tự xin từ Let's Encrypt (HTTP-01). Xem tình trạng:

```
set KUBECONFIG=infra\.credentials\staging.kubeconfig
kubectl get certificate -A
kubectl describe certificate app-tls -n app
kubectl get challenge -A
```

| Triệu chứng                                | Nguyên nhân thường gặp                                              | Cách xử lý                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Challenge` kẹt `pending`                  | DNS chưa trỏ về IP lối vào                                          | Hoàn tất bản ghi A, chờ lan truyền                                                  |
| `Challenge` báo timeout/connection refused | Cổng 80 chưa tới lối vào (nhóm bảo mật/cân bằng tải)                | Kiểm cân bằng tải có listener 80/443; `kubectl get svc -n ingress` có `EXTERNAL-IP` |
| `Order` lỗi "rate limit"                   | Xin quá nhiều lần trong thời gian ngắn (giới hạn của Let's Encrypt) | Chờ (thường 1 tuần cho cùng tên), không xóa/tạo liên tục                            |
| `ClusterIssuer` không `Ready`              | Email ACME sai hoặc cert-manager chưa lên                           | `kubectl describe clusterissuer letsencrypt`                                        |
| Có chứng chỉ nhưng trình duyệt cảnh báo    | Đang dùng chứng chỉ "staging" của Let's Encrypt, hoặc sai tên       | Kiểm `issuerRef` và `dnsNames`                                                      |

Gỡ rối chung: `kubectl logs -n cert-manager deploy/cert-manager`.
