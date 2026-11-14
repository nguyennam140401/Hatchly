# Hợp đồng: đầu ra bàn giao cho H2/H3 (FR-024, FR-014)

`pnpm infra outputs <env>` in một tài liệu JSON gộp đầu ra của hai stack. **Không giá trị nào là bí mật**:
bí mật chỉ xuất hiện dưới dạng *tên `Secret` + tên khóa*.

## 1. Đầu ra

| Khóa | Ví dụ (thử nghiệm) | Nguồn |
|---|---|---|
| `environment` | `staging` | tham số |
| `cluster.name`, `cluster.endpoint` | | `cloud` |
| `namespaces.app` / `.database` / `.monitoring` | `app` / `database` / `monitoring` | `platform` |
| `urls.web` | `https://app.staging.<gốc>` | tham số |
| `urls.api` | `https://api.staging.<gốc>` | tham số |
| `urls.web_origin_host` | `origin-app.staging.<gốc>` | tham số |
| `ingress.public_ip` | | `cloud` |
| `ingress.class` | `nginx` | `platform` |
| `ingress.cluster_issuer` | `letsencrypt` | `platform` |
| `dns_records[]` | `{ name, type, value }` | cả hai + giá trị CDN từ tham số |
| `database.host` | `pg-rw.database.svc` | `platform` |
| `database.port` / `.name` | `5432` / `app` | `platform` |
| `database.sslmode` | `require` | `platform` |
| `storage.endpoint`, `.public_endpoint`, `.region`, `.bucket`, `.force_path_style` | | `cloud` |
| `kms.key_id` | | `cloud` |
| `secrets.api` / `.worker` / `.migrate` / `.registry_pull` | `api-secrets` / … | `platform` |
| `service_accounts.api` / `.worker` / `.migrate` | `api` / `worker` / `migrate` | `platform` |
| `registry.server_image`, `registry.web_image` | `vcr.vngcloud.vn/<kho>/server` | tham số dùng chung |
| `monitoring.reserved` | `{ cpu, memory, storage_gb, storage_class }` | `platform` |
| `mail_capture.smtp_url_hint` | `smtp://mailpit.mail-capture.svc:1025` (chỉ thử nghiệm) | `platform` |

## 2. Ánh xạ sang biến cấu hình của ứng dụng

Đối chiếu với `apps/server/.env.example`. Kiểm thử `tooling/test/infra/handoff.spec.ts` so danh sách này với lược đồ
`config.schema.ts`: biến bắt buộc ở `staging/production` mà không có trong bảng → lỗi (FR-024 "MUST khớp").

### Không bí mật (đặt trong `ConfigMap`/kê khai của H2)

| Biến | Giá trị |
|---|---|
| `APP_ENV` | `environment` |
| `APP_VERSION` | H2 đặt theo ảnh |
| `API_PORT` / `WORKER_HEALTH_PORT` | `3000` / `3001` |
| `SHUTDOWN_TIMEOUT_MS` | `30000` (kèm `terminationGracePeriodSeconds: 35`) |
| `CORS_ORIGINS`, `WEB_ORIGINS` | `urls.web` |
| `WEB_BASE_URL` | `urls.web` |
| `TRUST_PROXY_HOPS` | `1` (lối vào); kiểm lại khi có CDN trước API |
| `MAIL_TRANSPORT` | `smtp` |
| `MAIL_FROM` | theo môi trường |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` | `storage.*` |
| `PLATFORM_GATEWAY_DRIVER`, `AI_GATEWAY_DRIVER`, `NOTIFICATIONS_DRIVER` | thử nghiệm: `fake` cho đến khi có bản thật; phát hành: bản thật |
| `FAKE_STATE_STORE` | thử nghiệm: `sandbox` khi còn driver `fake` |
| `STAGING_ALLOW_FAKES` | thử nghiệm: `true` khi còn driver `fake`; phát hành: không đặt (research R15) |
| `DATABASE_POOL_MAX` | `api`: 10 · `worker`: 20 |
| `KMS_KEY_ID` *(biến tương lai của `platform_gateway`)* | `kms.key_id` |

### Bí mật (đọc từ `Secret` bằng `envFrom`/`secretKeyRef`)

| Biến | `api` | `worker` | migration | `Secret` |
|---|---|---|---|---|
| `DATABASE_APP_URL` | ✔ | ✔ | | `api-secrets` / `worker-secrets` |
| `DATABASE_SUPPORT_URL` | ✔ | | | `api-secrets` |
| `DATABASE_SYSTEM_URL` | | ✔ | | `worker-secrets` |
| `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_*` | | | ✔ | `migrate-secrets` |
| `AUTH_THROTTLE_SECRET` | ✔ | | | `api-secrets` |
| `SMTP_URL` | ✔ | ✔ | | cả hai |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ✔ | ✔ | | cả hai |

RBAC: `ServiceAccount api` chỉ `get` được `api-secrets`; `worker` chỉ `worker-secrets`; `migrate` chỉ
`migrate-secrets`. Kiểm bằng `kubectl auth can-i` trong `pnpm infra smoke`.

Chuỗi kết nối có dạng `postgres://<vai trò>:<mật khẩu>@pg-rw.database.svc:5432/app?sslmode=require`; lệnh
`secrets init` dựng chuỗi từ mật khẩu vừa sinh nên H2 không phải ghép.

## 3. Yêu cầu với kê khai triển khai của H2

| Yêu cầu | Lý do |
|---|---|
| Tham chiếu ảnh theo **digest** (`@sha256:…`), cùng digest ở hai môi trường | FR-009; phát hành chạy đúng ảnh đã kiểm |
| `imagePullSecrets: registry-pull` | Kho ảnh riêng tư |
| `api` ×2, `worker` ×2, trải khác máy (`topologySpreadConstraints`) | FR-008, SC-007 |
| `worker`: `terminationGracePeriodSeconds: 35`; `requests` 0,5 CPU / 1,5 GB; `ephemeral-storage` giới hạn 4 GB | FR-010 |
| `api`: `requests` 0,25 CPU / 512 MB | Ngân sách máy (research R5) |
| Migration là `Job` riêng, `ServiceAccount migrate`, chạy trước khi đổi ảnh | Kiến trúc mục 3 |
| `Ingress` lớp `nginx`, chú thích `cert-manager.io/cluster-issuer: letsencrypt`, máy chủ `api.<base_domain>` và `origin-app.<base_domain>` | FR-009 |
| `web`: bỏ khối chuyển tiếp `/api` của nginx ở môi trường thật; giao diện build với địa chỉ API = `urls.api` | research R7 |
| Không đặt `hostNetwork`, không chạy quyền root | An toàn cơ bản |

## 4. Tín hiệu cho H3

| Tín hiệu | Nguồn |
|---|---|
| Hạn chứng chỉ | `certmanager_certificate_expiration_timestamp_seconds` (cảnh báo < 14 ngày) |
| Sức khỏe và độ trễ sao lưu CSDL | Chỉ số của CloudNativePG: `cnpg_pg_wal_archive_status`, `cnpg_collector_last_available_backup_timestamp`, thời điểm lưu WAL gần nhất (cảnh báo > 10 phút) |
| Chuyển bản chính | `cnpg_pg_replication_*`, sự kiện của `Cluster` |
| Số bản sẵn sàng | Chỉ số chuẩn của Kubernetes |
| Kết quả kiểm tra lệch | Issue `infra-drift:<env>` trên GitHub |
