# 04 – Triển khai ảnh và kiểm tra khói

Hạ tầng đã sẵn sàng; bước này đưa **ứng dụng thật** lên và chạy bộ kiểm tra khói (SC-003) để biết mọi mắt xích hạ tầng
phục vụ được ứng dụng. Dùng **bộ kê khai tạm** ở `infra/smoke-deploy/` — nó **chỉ để kiểm tra**; H2 sẽ viết kê khai
chính thức rồi xóa bộ này (đầu mỗi tệp có ghi "TẠM").

## 1. Dựng và đẩy hai ảnh

Cần robot `push` (mục B2). **Không** đưa khóa này vào cụm.

```
docker login vcr.vngcloud.vn            # dùng robot push
docker build -f Dockerfile -t vcr.vngcloud.vn/<kho>/server:smoke .
docker build -f apps/web/Dockerfile -t vcr.vngcloud.vn/<kho>/web:smoke .
docker push vcr.vngcloud.vn/<kho>/server:smoke
docker push vcr.vngcloud.vn/<kho>/web:smoke
```

Lệnh `docker push` in dòng `digest: sha256:…` — **chép nó**. Hoặc: `docker buildx imagetools inspect <ảnh>:smoke`.

### Vì sao buộc dùng digest, không dùng thẻ?

Thẻ (`:smoke`, `:latest`) có thể bị **đẩy đè** — cùng tên nhưng nội dung khác. Digest là dấu vân tay của nội dung: ảnh
chạy ở production **đúng là** ảnh đã kiểm ở thử nghiệm. Kiểm thử `smoke-deploy.spec.ts` sẽ lỗi nếu bạn dùng thẻ.

## 2. Điền `infra/smoke-deploy/overlays/staging`

- `images.yaml`: thay `sha256:0000…` bằng digest thật (hai chỗ `server`, một chỗ `web`; `registry` khớp `staging.tfvars`).
- `config.env`: thay `TODO-P6-base-domain` bằng tên miền thật; `S3_*` lấy từ `pnpm infra outputs staging`.
- `kustomization.yaml`: tên miền trong phần `patches` của Ingress.

Ở thử nghiệm, `config.env` có `STAGING_ALLOW_FAKES=true` cùng các driver `fake` vì ba cổng (nền tảng mạng xã hội, AI,
thông báo) chưa có bản thật. Biến này **chỉ** có ở thử nghiệm; production không bao giờ đặt nó (ảnh sẽ từ chối khởi động).

## 3. Nhập bí mật do bên ngoài cấp

Trước khi áp, ứng dụng cần: khóa S3 (`api-secrets`, `worker-secrets`), `SMTP_URL`, `registry-pull`, và khóa sao lưu
`pg-backup-s3`. Danh sách lệnh do `pnpm infra up` in ra; xem [06](06-bi-mat-va-khoa.md).

## 4. Áp và chạy kiểm tra khói

```
set KUBECONFIG=infra\.credentials\staging.kubeconfig
kubectl apply -k infra/smoke-deploy/overlays/staging
pnpm infra smoke staging
```

Mỗi mục in `[đạt]`/`[lỗi]`/`[bỏ qua]`, cuối cùng là tỷ lệ đạt. Mục tiêu **100%** (SC-003).

| Mục                                                      | Kiểm gì                                             | Nếu `[lỗi]`                                                                        |
| -------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| api, worker sẵn sàng 2/2                                 | Cả hai chạy 2 bản                                   | `kubectl get pods -n app`, `kubectl describe pod …`                                |
| Job migration hoàn tất                                   | Vai trò CSDL + migration đã áp                      | `kubectl logs job/migrate -n app`                                                  |
| `/healthz` 200, HTTP→HTTPS, TLS                          | Lối vào + chứng chỉ                                 | [03](03-dns-va-chung-chi.md) mục 4                                                 |
| Giao diện: 200, đường dẫn lạ, cache, noindex             | Ảnh `web` đúng, CDN/nguồn đúng                      | Kiểm `SEARCH_INDEXING`, `API_UPSTREAM` không đặt                                   |
| Ghi/đọc CSDL bằng vai trò `app`; không TLS bị từ chối    | CSDL và mật khẩu đúng                               | `kubectl get cluster -n database`; kiểm `DATABASE_APP_URL`                         |
| Đăng ký + đăng nhập; thư ở Mailpit                       | Chuỗi email → xác minh → phiên                      | Kiểm `SMTP_URL` trỏ `mailpit.mail-capture.svc:1025`                                |
| Tải 100 MB thẳng lên kho tệp                             | Đường dẫn ký sẵn, CORS, khóa S3                     | Kiểm `S3_*`, bucket policy                                                         |
| 9 phép `can-i`                                           | Mỗi tài khoản chỉ đọc đúng Secret của mình (FR-014) | Kiểm `Role`/`RoleBinding` ở namespace `app`                                        |
| Secret không khóa sai chỗ, không robot `push`            | Cô lập bí mật                                       | Xóa Secret sai, chạy lại `secrets init`                                            |
| GET không xác thực vào bucket media/sao lưu bị từ chối   | Bucket riêng tư (SC-009)                            | Kiểm bucket policy và chặn truy cập công khai                                      |
| Cổng 5432 công khai không mở                             | CSDL không lộ ra internet                           | Kiểm nhóm bảo mật                                                                  |
| Xóa đối tượng vẫn thấy phiên bản cũ; đủ ba luật vòng đời | Lưu phiên bản + vòng đời (SC-010)                   | Bật versioning; nếu vStorage không lọc theo nhãn, mục `tmp` ghi "phụ thuộc Worker" |

## 5. Xem thư thử ở Mailpit

Giao diện Mailpit **không** có địa chỉ công khai. Xem bằng:

```
kubectl port-forward -n mail-capture svc/mailpit 8025:8025
```

rồi mở `http://localhost:8025`. Chỉ có ở thử nghiệm.

## 6. Lưu ý

- Bộ kê khai này **tạm**; đừng sửa nó thành chính thức. H2 thay bằng kê khai riêng đúng các yêu cầu ở
  `contracts/handoff-outputs.md` mục 3.
- Đừng quên: **mỗi lần đổi ảnh = digest mới** trong `images.yaml`.
