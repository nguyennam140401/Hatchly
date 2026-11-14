# Quickstart: kiểm chứng hạ tầng Terraform (007)

Hướng dẫn chạy để chứng minh tính năng hoạt động từ đầu đến cuối. Đây là bản **kiểm chứng**; hướng dẫn triển
khai từng bước cho người mới (FR-030) viết ở bước implement, tại `infra/docs/`.

Tham chiếu: lệnh – [contracts/infra-cli.md](contracts/infra-cli.md) · việc làm tay –
[contracts/one-time-bootstrap.md](contracts/one-time-bootstrap.md) · tham số –
[contracts/environment-parameters.md](contracts/environment-parameters.md) · đầu ra –
[contracts/handoff-outputs.md](contracts/handoff-outputs.md).

## 0. Chuẩn bị máy

| Cần | Kiểm |
|---|---|
| Node 24 + pnpm (đã có của dự án) | `pnpm -v` |
| Terraform đúng phiên bản trong `infra/.terraform-version` | `terraform version` |
| tflint, kubectl | `tflint --version`, `kubectl version --client` |
| Docker (dựng ảnh để kiểm tra khói) | `docker version` |

## 1. Kiểm tra tĩnh – không cần tài khoản đám mây (FR-027, SC-008, SC-009)

```powershell
pnpm infra check
```

**Mong đợi**: bảng tổng kết 7 bước đều đạt, mã thoát 0. Làm được ngay cả khi P6 chưa xong.

Thử phản chứng (mỗi thử nghiệm sửa rồi hoàn lại):

| Sửa | Bước phải lỗi |
|---|---|
| Đặt `region = "sgp01"` trong `staging.tfvars` | Luật an toàn: vùng ngoài danh sách |
| Thêm `"*"` vào `web_origins` | Luật an toàn: CORS |
| Đổi `postgres_major` chỉ ở `production.tfvars` | So tham số |
| Dán một khóa truy cập mẫu vào `staging.tfvars` | Quét bí mật |
| Thêm `admin_cidrs = ["0.0.0.0/0"]` | Luật an toàn: điểm quản trị cụm |

## 2. US1 – dựng thử nghiệm từ tài khoản trống (SC-001, SC-002, SC-003)

Bấm giờ từ đây; mục tiêu ≤ 2 giờ.

```powershell
# Làm các mục A, B, C1–C8, C11 của danh sách khởi tạo, rồi:
pnpm infra bootstrap-check staging      # mọi mục [đạt] trừ C9, C10
pnpm infra up staging                   # dựng cloud → platform → secrets init → in bản ghi DNS
# Làm C9 (CDN), C10 (DNS) theo danh sách vừa in
pnpm infra dns-check staging            # lặp lại tới khi đạt; kiểm cả chứng chỉ đã cấp
pnpm infra secrets set staging api-secrets S3_ACCESS_KEY_ID      # và các khóa nhập tay còn lại
pnpm infra outputs staging
```

Triển khai ảnh hiện có bằng bộ kê khai tạm:

```powershell
docker build -t <kho ảnh>/server:<commit> . ; docker push <kho ảnh>/server:<commit>
docker build -f apps/web/Dockerfile -t <kho ảnh>/web:<commit> . ; docker push <kho ảnh>/web:<commit>
# ghi digest của hai ảnh vào infra/smoke-deploy/overlays/staging/images.yaml
kubectl apply -k infra/smoke-deploy/overlays/staging
pnpm infra smoke staging
```

**Mong đợi của `smoke`** (mỗi dòng là một mục, phải 100% đạt):

- `api` 2/2 và `worker` 2/2 sẵn sàng; `Job` migration hoàn tất bằng `ServiceAccount migrate`.
- `GET https://api.staging.<gốc>/healthz` → 200; `http://…` → chuyển sang HTTPS; chứng chỉ hợp lệ.
- `https://app.staging.<gốc>/` → 200 qua CDN; đường dẫn lạ trả `index.html`; có `X-Robots-Tag: noindex`.
- Ghi rồi đọc một dòng bằng vai trò `app`; kết nối không TLS bị từ chối.
- Đăng ký + đăng nhập một tài khoản thử; xin đường dẫn ký sẵn; tải tệp 100 MB **thẳng** lên kho tệp; đối tượng
  nằm dưới `tenants/{accountId}/`; nhật ký `api` không có yêu cầu thân 100 MB.
- `kubectl auth can-i get secret/migrate-secrets --as system:serviceaccount:app:api` → `no` (và các cặp còn
  lại của FR-014).
- Bucket media: `GET` không xác thực → từ chối. Cổng 5432 từ internet → không mở.
- Bucket sao lưu: `GET` không xác thực → từ chối.
- Xóa một đối tượng thử → liệt kê vẫn thấy phiên bản cũ; cấu hình vòng đời bucket media có đủ ba luật (SC-010).
- Email đăng ký xuất hiện ở hộp thư bắt giữ, không ra ngoài.

Chạy lại không đổi gì (SC-002):

```powershell
pnpm infra plan staging     # mong đợi: "Không có thay đổi" ở cả hai stack, mã thoát 0
```

Chạy lại sau lỗi giữa chừng (FR-004): trong lúc `pnpm infra up staging` đang dựng nhóm máy, ngắt bằng Ctrl+C;
chạy lại `pnpm infra up staging` → tiếp tục, không tạo trùng (`terraform state list` không có tài nguyên lặp).

## 3. FR-034 – tắt và bật thử nghiệm (SC-012)

```powershell
pnpm infra power staging off     # mong đợi: không còn máy; outputs vẫn in cùng public_ip
pnpm infra power staging on      # mong đợi: in tổng thời gian ≤ 60 phút
pnpm infra dns-check staging     # đạt mà không sửa bản ghi nào
pnpm infra smoke staging
```

Đặt `power_lock = true` → `power staging off` thoát mã 3.

## 4. US2 – phát hành cùng hình dạng, tách hẳn (SC-004, SC-005, SC-007)

```powershell
pnpm infra bootstrap-check production
pnpm infra up production
pnpm infra dns-check production
kubectl apply -k infra/smoke-deploy/overlays/production     # cùng digest với thử nghiệm
pnpm infra smoke production
```

`smoke production` chạy thêm:

- **SC-004**: liệt kê loại tài nguyên trong trạng thái hai môi trường → trùng nhau, trừ `mail-capture`.
- **SC-005**: dùng hồ sơ chứng thực `staging` thử đọc bucket media / bucket sao lưu / bucket trạng thái /
  `Secret` / khóa KMS của phát hành → tất cả bị từ chối; và ngược lại. Từ một pod ở thử nghiệm, kết nối tới
  địa chỉ nội bộ của CSDL phát hành → không tới được.

Phép thử phục hồi (làm tay, ghi kết quả vào `infra/docs/ket-qua-kiem-chung.md`):

| Thử | Mong đợi |
|---|---|
| Xóa một máy trong nhóm máy phát hành (bảng điều khiển) trong lúc gọi `healthz` mỗi giây | Gián đoạn ≤ 1 phút; đủ 2+2 bản trong ≤ 5 phút |
| `kubectl delete pod` bản chính của CSDL | Bản dự phòng lên thay; ứng dụng kết nối lại qua `pg-rw` trong ≤ 5 phút; không đổi cấu hình |

## 5. US3 – thay đổi có kiểm soát (SC-011)

| Bước | Lệnh | Mong đợi |
|---|---|---|
| Sửa mã (thêm một nhãn), commit | | |
| Thử đi thẳng lên phát hành | `pnpm infra plan production` | Mã 3: "chưa áp dụng thành công ở thử nghiệm" |
| Áp dụng ở thử nghiệm | `pnpm infra plan staging` → `apply staging` | Bản ghi áp dụng mới |
| Xem trước phát hành | `pnpm infra plan production` | Tóm tắt; tệp lưu ở `infra/.plans/production/` |
| Sửa thêm một dòng tham số rồi áp dụng | `pnpm infra apply production` | Mã 3: "mã hoặc tham số đã đổi" |
| Xem trước lại, áp dụng | `plan` → `apply production` | Thành công; `pnpm infra records production --last 1` có commit, dấu, tóm tắt |
| Đổi tên bucket media trong một nhánh thử | `pnpm infra plan production` | Dòng `!! THAY THẾ` đứng đầu; `apply` mã 3 |
| Hai cửa sổ cùng `apply staging` | | Cửa sổ sau bị từ chối vì khóa trạng thái |
| Sửa tay một luật nhóm bảo mật trên bảng điều khiển | `pnpm infra drift staging` | Mã 2, in địa chỉ tài nguyên và thuộc tính lệch |
| Sửa tay một `Deployment` trong cụm | `pnpm infra drift staging` (trên máy) | Mã 2; quy trình `infra-drift` trên GitHub **không** thấy lệch này (chỉ kiểm stack `cloud`) |
| Chạy tay quy trình `infra-drift` | GitHub | Việc thất bại + issue `infra-drift:staging`; sửa lại → lần chạy sau đóng issue |
| Quét bí mật gồm cả bản xem trước | `node tooling/scan-secrets.mjs infra` | 0 kết quả |

## 6. US4 – diễn tập khôi phục (SC-006)

Kịch bản độc lập chạy trên thử nghiệm:

```powershell
# 1) ghi dòng đánh dấu vào CSDL thử nghiệm, ghi lại thời điểm T
# 2) chờ 10 phút, xóa dòng đó
pnpm infra drill start --from staging --target-time <T + 1 phút>
pnpm infra drill verify --marker "select 1 from sandbox.tenant_notes where …"
pnpm infra drill destroy
pnpm infra records staging --last 1
```

**Mong đợi**: bản ghi diễn tập `result = "pass"`, `durationSeconds ≤ 3600`, `dataLossSeconds ≤ 300`,
`markerFound = true`; các phép thử cô lập đạt (gồm không kết nối được `pg-rw` của nguồn); sau `destroy` không còn tài nguyên nhãn `environment=drill`.

Trước ngày ra mắt: lặp lại với `--from production` (cần C12) và lưu bản ghi đầu tiên.

## 7. SC-013 – đổi biến thể và nhà cung cấp không đụng mã ứng dụng

- `git diff --stat` của một nhánh thử đổi `db_variant` → chỉ có tệp trong `infra/`.
- Bộ `infra/stacks/cloud/tests/provider-contract.tftest.hcl` chạy với một module nhà cung cấp giả
  (`infra/tests/fixtures/provider-stub`) đạt mà không sửa `stacks/platform` – chứng minh stack nền tảng chỉ
  phụ thuộc hợp đồng.

## Khi nào coi là xong

- [x] Mục 1 đạt trên máy (`pnpm infra check` 7/7); quy trình `infra-static` đã viết, chạy khi đẩy lên GitHub.
- [ ] Mục 2, 3 đạt trên thử nghiệm thật; thời gian dựng ≤ 2 giờ được ghi lại.
- [ ] Mục 4 đạt trên phát hành (có thể sau, trước ngày ra mắt).
- [ ] Mục 5 đạt; quy trình `infra-drift` chạy theo lịch ít nhất 2 ngày liên tiếp.
- [ ] Mục 6 đạt với `--from staging`; bản ghi `--from production` có trước ngày ra mắt.
- [ ] Mọi mục "Chặn" trong danh sách xác minh P6 ([research.md](research.md)) đã có câu trả lời đạt trước khi
      đưa dữ liệu khách hàng thật vào phát hành.
