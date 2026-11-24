# 06 – Bí mật và khóa

> **Quy tắc vàng:** bí mật chỉ nằm ở hai nơi — (1) **trong cụm** dưới dạng `Secret` của Kubernetes, (2) **trình quản lý
> mật khẩu** của người vận hành. Không nằm trong mã, tệp tham số, trạng thái Terraform, nhật ký hay tin nhắn.

## 1. Bảng bí mật

| Secret (namespace)          | Khóa                                                                                    | Ai đọc                              | Nguồn                         |
| --------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `api-secrets` (`app`)       | `DATABASE_APP_URL`, `DATABASE_SUPPORT_URL`, `AUTH_THROTTLE_SECRET`                      | ServiceAccount `api`                | tự sinh (`secrets init`)      |
|                             | `SMTP_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                  | `api`                               | nhập tay (`secrets set`)      |
|                             | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (tùy chọn, xem mục 3)                             | `api`                               | nhập tay (`secrets set`)      |
| `worker-secrets` (`app`)    | `DATABASE_APP_URL`, `DATABASE_SYSTEM_URL`                                               | `worker`                            | tự sinh                       |
|                             | `SMTP_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                  | `worker`                            | nhập tay                      |
|                             | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (tùy chọn, xem mục 3)                             | `worker`                            | nhập tay                      |
| `migrate-secrets` (`app`)   | `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_OWNER/APP/SYSTEM/SUPPORT` | Job migration                       | tự sinh                       |
| `registry-pull` (`app`)     | `.dockerconfigjson` (robot **chỉ kéo**)                                                 | kéo ảnh                             | nhập tay                      |
| `pg-backup-s3` (`database`) | `ACCESS_KEY_ID`, `ACCESS_SECRET_KEY` (tài khoản `dbbackup-<env>`)                       | CloudNativePG                       | nhập tay                      |
| `pg-superuser` (`database`) | tài khoản quản trị CSDL                                                                 | công cụ (dựng `DATABASE_ADMIN_URL`) | toán tử CloudNativePG tự sinh |

**Bất biến (FR-014):** `api-secrets` **không** có chuỗi kết nối quyền chủ sở hữu/quản trị/hệ thống; `worker-secrets`
**không** có quyền chủ sở hữu/quản trị. Mỗi ServiceAccount chỉ `get` được đúng một Secret. `pnpm infra smoke` kiểm.

## 2. Các lệnh

```
pnpm infra secrets init staging                         # tạo Secret tự sinh (chỉ tạo cái chưa có; chạy lại không đổi gì)
pnpm infra secrets set  staging api-secrets S3_SECRET_ACCESS_KEY   # nhập giá trị, KHÔNG hiện chữ khi gõ
pnpm infra secrets list staging                         # tên, khóa, nguồn, lúc xoay – KHÔNG giá trị
pnpm infra secrets rotate staging db-app                # xoay mật khẩu vai trò CSDL
```

- `set` đọc giá trị từ bàn phím, không nhận qua đối số dòng lệnh (để không vào lịch sử lệnh). Qua đường ống thì từ chối.
- `registry-pull`: hỏi tên robot (`robot$pull-staging`) và mật khẩu, tự dựng cấu hình đăng nhập kho ảnh.

## 3. Nhập bí mật do bên ngoài cấp

| Giá trị                               | Lấy ở đâu                                                                             | Lệnh                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Khóa S3 của `app-<env>`               | Bảng điều khiển IAM (C4/C6)                                                           | `set <env> api-secrets S3_ACCESS_KEY_ID` … và `worker-secrets`                  |
| `SMTP_URL`                            | Thử nghiệm: `smtp://mailpit.mail-capture.svc:1025`; production: Amazon SES (SMTP)     | `set <env> api-secrets SMTP_URL`, `worker-secrets`                              |
| Khóa sao lưu `dbbackup-<env>`         | IAM (C5)                                                                              | `set <env> pg-backup-s3 ACCESS_KEY_ID` / `ACCESS_SECRET_KEY`                    |
| Robot kéo ảnh                         | vCR (B3)                                                                              | `set <env> registry-pull .dockerconfigjson`                                     |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Bảng điều khiển nhà cung cấp AI (chỉ cần khóa của nhà cung cấp mà tuyến AI đang dùng) | `set <env> api-secrets ANTHROPIC_API_KEY` … và `worker-secrets` (cả hai Secret) |
| Về sau: mã quyền Meta, Zalo           | Nhà cung cấp tương ứng                                                                | thêm khóa vào bảng ở `tooling/infra/lib/handoff-map.mjs` rồi dùng `set`         |

**Khóa nhà cung cấp AI (015):** là bí mật TÙY CHỌN – không có thì ứng dụng vẫn khởi động khi `AI_GATEWAY_DRIVER=fake`
(mặc định thử nghiệm, `overlays/staging/config.env`); chỉ bắt buộc khi chuyển `AI_GATEWAY_DRIVER=real` và tuyến bật dùng
nhà cung cấp đó. Khóa KHÔNG đặt trong ConfigMap/`config.env`, không `secrets init` tự sinh (do bên ngoài cấp). Cả `api` và
`worker` đều cần (Cổng AI chạy ở cả hai). Đặt xong: `kubectl rollout restart deploy/api deploy/worker -n app`. Ghi cổng
chuyển `real` ở `overlays/production/config.env` khi đã có khóa (chưa đặt `AI_GATEWAY_DRIVER` ở đó thì chỉ chạy `--infra-only`).

## 4. Xoay (đổi định kỳ)

| Bí mật                                        | Chu kỳ                                                   | Cách làm                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mật khẩu vai trò CSDL, `AUTH_THROTTLE_SECRET` | Khi nghi lộ hoặc hằng năm                                | `pnpm infra secrets rotate <env> db-owner\|db-app\|db-system\|db-support\|auth-throttle`, sau đó `kubectl rollout restart deploy/api deploy/worker -n app` |
| Khóa S3 và mật khẩu tài khoản dịch vụ         | **≤ 12 tháng** (`contracts/one-time-bootstrap.md` mục F) | Tạo khóa mới ở IAM → `secrets set` → thu hồi khóa cũ → cập nhật `infra/.credentials/<env>.env`                                                             |
| Khóa KMS                                      | Theo chính sách của bạn                                  | Xoay khóa **giữ phiên bản cũ** để dữ liệu đã mã hóa vẫn giải mã được (điều kiện V4)                                                                        |

`rotate` chạy theo bước và in rõ bước đã xong; lỗi giữa chừng thì chạy lại an toàn (đổi mật khẩu CSDL trước, Secret sau —
nếu dừng ở giữa, Secret còn mật khẩu cũ nhưng CSDL đã mới: chạy lại `rotate` cùng tên để đồng bộ).

## 5. Rủi ro còn lại nếu V7 không đạt

Nếu VKS **không mã hóa `Secret` khi lưu** (câu V7), `Secret` nằm ở etcd dạng chỉ mã hóa base64. Ta chấp nhận vì: (a) RBAC
hẹp (mỗi tài khoản chỉ đọc Secret của mình); (b) **mã quyền nền tảng** (nhạy cảm nhất) mã hóa riêng ở tầng ứng dụng bằng
khóa KMS (hiến pháp VII); trong `Secret` chỉ có mật khẩu CSDL và khóa S3; (c) nhật ký truy cập API cụm (nếu V7 có) để truy vết.
Ghi quyết định này vào bảng kết quả khi có câu trả lời.

## 6. Khi nghi lộ bí mật

1. Xoay ngay bí mật đó (mục 4) và thu hồi khóa cũ ở nhà cung cấp.
2. Nếu là khóa tài khoản dịch vụ: thu hồi ở IAM, tạo mới, cập nhật `infra/.credentials/<env>.env`.
3. Ghi lại thời điểm và phạm vi vào nhật ký sự cố.
