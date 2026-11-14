# Data Model: Hạ tầng Terraform – môi trường thử nghiệm và phát hành

Tính năng này **không thêm bảng CSDL nào**. "Mô hình dữ liệu" ở đây là các thực thể cấu hình và bản ghi vận
hành: tệp tham số, trạng thái, đầu ra, bản ghi. Tên trong mã là tiếng Anh; cột "Đặc tả" là tên ở mục Key
Entities của [spec.md](spec.md).

## 1. Bảng thuật ngữ Việt → Anh (bổ sung cho architecture.md mục 11)

| Đặc tả | Mã | Đặc tả | Mã |
|---|---|---|---|
| Môi trường | `environment` (`staging`, `production`, `drill`) | Lớp nhà cung cấp | `provider layer` (`modules/provider-vngcloud`) |
| Bộ tham số môi trường | `envs/<env>.tfvars` | Tầng nền tảng | `platform` stack |
| Trạng thái hạ tầng | `state` (`cloud.tfstate`, `platform.tfstate`) | Tầng đám mây | `cloud` stack |
| Bản xem trước | `plan` (`*.tfplan` + `meta.json`) | Dấu định nghĩa | `definitionHash` |
| Bản ghi áp dụng | `apply record` | Bản ghi diễn tập khôi phục | `drill record` |
| Kiểm tra lệch | `drift check` | Danh sách khởi tạo một lần | `one-time bootstrap` |
| Bảo vệ xóa | `deletion_protection` | Tắt/bật thử nghiệm | `powered`, `power_lock` |
| Biến thể CSDL | `db_variant` (`cnpg` \| `managed`) | Môi trường tạm diễn tập | `environment_kind = "restore_drill"` |
| Đầu ra bàn giao | `handoff outputs` | Kho ảnh container | `image registry` |
| Hộp thư bắt giữ | `mail capture` (Mailpit) | Danh sách địa chỉ quản trị | `admin_cidrs` |

## 2. Environment (Môi trường)

Một môi trường = một tệp tham số + một tệp cấu hình backend + hai tệp trạng thái.

| Thuộc tính | Kiểu | Quy tắc |
|---|---|---|
| `environment` | `staging` \| `production` \| `drill` | Bắt buộc; dùng trong tên và nhãn mọi tài nguyên |
| `environment_kind` | `standard` \| `restore_drill` | `drill` ⇔ `restore_drill` |
| `project_id` | chuỗi | Project của nhà cung cấp; `staging` ≠ `production`; `drill` = project của môi trường nguồn |
| `region` | chuỗi | Phải thuộc `allowed_regions` (chỉ vùng trong nước) – FR-007 |
| `base_domain` | tên miền | Phát hành: `<gốc>`; thử nghiệm: `staging.<gốc>` |
| `name_prefix` | chuỗi ngắn | Tiền tố tên tài nguyên, giống nhau ở hai môi trường |

**Vòng đời**

```text
(chưa có) ──bootstrap tay + bootstrap-check──▶ sẵn sàng dựng
sẵn sàng dựng ──apply cloud ▶ apply platform ▶ secrets init ▶ DNS tay ▶ dns-check──▶ đang chạy
đang chạy ──power off──▶ đã tắt ──power on──▶ đang chạy          (chỉ staging, khi power_lock = false)
drill:  (chưa có) ──drill start──▶ đang khôi phục ──drill verify──▶ đã đo ──drill destroy──▶ (chưa có)
```

`production` không có chuyển trạng thái "tắt" và không có lệnh hủy trong CLI.

## 3. Environment parameters (Bộ tham số)

Lược đồ đầy đủ, giá trị mặc định và kiểm tra: [contracts/environment-parameters.md](contracts/environment-parameters.md).

Quy tắc bất biến:

- **Không chứa bí mật.** Chứng thực của provider đến từ biến môi trường của tiến trình, không từ tệp.
- Chỉ các khóa thuộc **danh sách được phép khác nhau** (FR-003) mới được có giá trị khác giữa
  `staging.tfvars` và `production.tfvars`; mọi khóa khác phải bằng nhau. Kiểm bằng `pnpm infra check`.
- Khóa chỉ có ở một môi trường là lỗi, trừ ba khóa của FR-029/FR-034: `mail_capture_enabled`, `powered`,
  `power_lock` (đều có ở cả hai tệp, phát hành bị ép giá trị an toàn bằng `validation`).

## 4. State (Trạng thái hạ tầng)

| Thuộc tính | Giá trị |
|---|---|
| Nơi lưu | Bucket `<prefix>-tfstate-<env>` trong project của môi trường, vùng trong nước |
| Khóa đối tượng | `cloud.tfstate`, `platform.tfstate`; môi trường tạm: `drill/cloud.tfstate`, `drill/platform.tfstate` |
| Phiên bản | Bật lưu phiên bản bucket; giữ phiên bản cũ ≥ 90 ngày |
| Khóa | Tệp khóa `<key>.tflock` (hoặc `locks/<stack>.json` nếu V6 không đạt) |
| Nội dung | Định danh và thuộc tính tài nguyên. **Không có giá trị bí mật** (research R8) |
| Ai đọc | `terraform-<env>` (đọc/ghi), `drift-<env>` (chỉ đọc) |

Cùng bucket, các tiền tố khác:

| Tiền tố | Nội dung |
|---|---|
| `records/applied/` | Bản ghi áp dụng (mục 6) |
| `records/drills/` | Bản ghi diễn tập (mục 7) |
| `runtime/power.json` | `{ "powered": true\|false, "changedAt": "<ISO>", "by": "<tên máy/người>" }` |

## 5. Plan (Bản xem trước đã lưu)

Chỉ nằm trên máy người vận hành, thư mục `infra/.plans/<env>/` (gitignore).

| Tệp | Nội dung |
|---|---|
| `<stack>.tfplan` | Tệp nhị phân của Terraform |
| `<stack>.meta.json` | Xem dưới |

```json
{
  "environment": "production",
  "stack": "cloud",
  "definitionHash": "sha256:…",
  "paramsHash": "sha256:…",
  "gitCommit": "…",
  "createdAt": "2026-11-20T03:10:00Z",
  "expiresAt": "2026-11-21T03:10:00Z",
  "summary": { "create": 2, "update": 1, "replace": 0, "delete": 0 },
  "protectedChanges": [],
  "stagingRecord": "records/applied/sha256-….json"
}
```

Quy tắc: `apply` từ chối khi `definitionHash`/`paramsHash` tính lại khác, khi quá `expiresAt`, khi
`protectedChanges` khác rỗng mà thiếu xác nhận, khi cây git không sạch.

## 6. Apply record (Bản ghi áp dụng)

Ghi sau **mỗi** lần áp dụng thành công, ở cả hai môi trường. Bản ghi của thử nghiệm là bằng chứng cho điều
kiện (a) của FR-026; bản ghi của phát hành là bằng chứng cho SC-011.

```json
{
  "environment": "staging",
  "stack": "platform",
  "definitionHash": "sha256:…",
  "paramsHash": "sha256:…",
  "gitCommit": "…",
  "appliedAt": "2026-11-20T03:25:11Z",
  "operator": "<git user.name>",
  "summary": { "create": 2, "update": 1, "replace": 0, "delete": 0 },
  "dataLossConfirmed": false,
  "protectedChanges": []
}
```

Khóa đối tượng: `records/applied/<definitionHash>/<stack>-<appliedAt>.json`. Chỉ thêm, không sửa.
"Đã chạy ở thử nghiệm" ⇔ tồn tại bản ghi của **cả hai** stack với đúng `definitionHash`.

## 7. Drill record (Bản ghi diễn tập khôi phục)

```json
{
  "sourceEnvironment": "production",
  "targetTime": "2026-12-01T02:00:00Z",
  "startedAt": "2026-12-01T03:00:00Z",
  "queryableAt": "2026-12-01T03:31:40Z",
  "durationSeconds": 1900,
  "recoveredTo": "2026-12-01T01:58:12Z",
  "dataLossSeconds": 108,
  "markerFound": true,
  "result": "pass",
  "operator": "<git user.name>",
  "destroyedAt": "2026-12-01T03:50:00Z"
}
```

`result = "pass"` ⇔ `durationSeconds ≤ 3600` và `dataLossSeconds ≤ 300` và `markerFound`.
Khóa: `records/drills/<startedAt>.json` trong bucket trạng thái của môi trường nguồn.

## 8. Tài nguyên của một môi trường

| Thực thể (đặc tả) | Tài nguyên | Stack | Chứa dữ liệu (được bảo vệ – FR-025) |
|---|---|---|---|
| Mạng | Mạng riêng, mạng con, nhóm bảo mật | `cloud` | Không |
| Cụm chạy ứng dụng | Cụm VKS, nhóm máy, cân bằng tải | `cloud` | Không |
| Kho tệp – media | Bucket `<prefix>-media-<env>` | `cloud` | **Có** |
| Kho tệp – sao lưu CSDL | Bucket `<prefix>-db-backup-<env>` | `cloud` | **Có** |
| Kho tệp – trạng thái | Bucket `<prefix>-tfstate-<env>` | khởi tạo tay | **Có** (ngoài Terraform) |
| Khóa mã hóa | Khóa KMS | khởi tạo tay | **Có** (ngoài Terraform; xóa có thời gian chờ) |
| Điểm phân phối CDN | Điểm phân phối + tên miền giao diện | khởi tạo tay | Không |
| Không gian tên, hạn mức, chính sách mạng | `Namespace`, `ResourceQuota`, `NetworkPolicy` | `platform` | `database`: **Có** |
| Lối vào + chứng chỉ | NGINX Ingress Controller, cert-manager, `ClusterIssuer` | `platform` | Không |
| CSDL | Toán tử CloudNativePG, `Cluster` `pg`, `ScheduledBackup`, kho sao lưu | `platform` | **Có** |
| Bí mật | Tên `Secret` + RBAC (giá trị do `secrets init/set`) | `platform` | Không (giá trị ngoài Terraform) |
| Hộp thư bắt giữ | Mailpit (chỉ khi `mail_capture_enabled`) | `platform` | Không |

Nhãn bắt buộc trên mọi tài nguyên (FR-006): `project`, `environment`, `component`.

## 9. Secret (Bí mật)

| Tên `Secret` (ns `app`) | Khóa | Nguồn | Thành phần đọc |
|---|---|---|---|
| `api-secrets` | `DATABASE_APP_URL`, `DATABASE_SUPPORT_URL`, `AUTH_THROTTLE_SECRET`, `SMTP_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | tự sinh + nhập | `api` |
| `worker-secrets` | `DATABASE_APP_URL`, `DATABASE_SYSTEM_URL`, `SMTP_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | tự sinh + nhập | `worker` |
| `migrate-secrets` | `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_OWNER/APP/SYSTEM/SUPPORT` | tự sinh | tác vụ migration |
| `registry-pull` | `.dockerconfigjson` | nhập (robot `pull-<env>`) | kubelet |

Không gian tên `database`: `pg-superuser` (toán tử sinh), `pg-backup-s3` (nhập – khóa của `dbbackup-<env>`).

Mỗi `Secret` mang chú thích `infra/rotated-at` (thời điểm xoay gần nhất) và `infra/source`
(`generated` \| `external`). Bí mật về sau (AI, Meta, Zalo) thêm khóa vào `api-secrets`/`worker-secrets` bằng
`secrets set`, không đổi lược đồ.

Bất biến (FR-014): `api-secrets` không bao giờ có khóa `DATABASE_OWNER_URL`, `DATABASE_ADMIN_URL`,
`DATABASE_SYSTEM_URL`; `worker-secrets` không có `DATABASE_OWNER_URL`, `DATABASE_ADMIN_URL`. Lệnh `secrets`
từ chối ghi các khóa này sai chỗ; `pnpm infra smoke` kiểm lại.

## 10. Handoff outputs (Đầu ra bàn giao)

Danh sách và ánh xạ sang biến cấu hình của ứng dụng: [contracts/handoff-outputs.md](contracts/handoff-outputs.md).
Không đầu ra nào là bí mật; mọi `output` cấm `sensitive = true` (kiểm bằng `terraform test`) – thứ gì cần
`sensitive` thì không được là đầu ra.

## 11. Image registry (Kho ảnh container)

| Thuộc tính | Giá trị |
|---|---|
| Phạm vi | Dùng chung, ngoài hai môi trường; khởi tạo tay một lần |
| Địa chỉ | `vcr.vngcloud.vn/<backendName>/server`, `…/web` |
| Robot | `push` (không cấp cho cụm nào), `pull-staging`, `pull-production` (chỉ kéo) |
| Tham chiếu ảnh khi triển khai | Bắt buộc theo digest: `…/server@sha256:…` |
| Nội dung cấm | Bí mật, dữ liệu khách hàng (ảnh hiện tại không chứa `.env` – `.dockerignore`) |
