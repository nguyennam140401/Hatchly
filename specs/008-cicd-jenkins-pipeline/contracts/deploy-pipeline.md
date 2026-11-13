# Hợp đồng: Quy trình triển khai

Áp dụng cho `ops/ci/Jenkinsfile.deploy`, `ops/ci/Jenkinsfile.redeploy`, `ops/deploy/**`. Lý do thiết kế:
[research.md](../research.md) R13–R16, R18, R20–R22. Lược đồ dữ liệu: [data-model.md](../data-model.md).

## 1. Kích hoạt và ánh xạ

| Job | Nhánh | Môi trường | Kích hoạt |
|---|---|---|---|
| `deploy/staging/deploy` | `dev` | `staging` (test) | webhook `push`; thăm dò 5 phút |
| `deploy/production/deploy` | `master` | `production` (release) | webhook `push`; thăm dò 5 phút |
| `deploy/<env>/redeploy` | — | theo thư mục | tay, có tham số |

Quy trình MUST dừng ngay nếu nhánh đang chạy ≠ `EnvironmentParams.branch` hoặc tên thư mục job ≠
`EnvironmentParams.name` (FR-003: không ánh xạ chéo). Không có bước chờ người xác nhận.

Đồng thời (FR-035): `disableConcurrentBuilds()` (không hủy lần đang chạy) + khóa `deploy-<env>` bao từ bước 2 đến
bước 6. Các lần chờ của cùng job được Jenkins gộp về commit mới nhất.

## 2. Các bước (FR-027) – một bước không đạt thì dừng các bước sau

| # | Bước | Làm gì | Hỏng thì |
|---|---|---|---|
| 1 | `gates` | `pnpm verify --ci` đầy đủ trên commit đã hợp nhất (gồm `check:image`, `db:compat` với bản đang chạy ở chính môi trường này) | dừng; môi trường giữ nguyên |
| 2 | `image` | dựng (hoặc dùng lại nếu thẻ đã có) → đẩy → lấy digest → quét Trivy theo `vulnerabilityPolicy` | dừng; môi trường giữ nguyên |
| — | *cửa môi trường* | `provisioned: false` → kết thúc "chưa có môi trường đích" (không đỏ) | — |
| 3 | `migrate` | Job `migrate-<sha12>` ở namespace `migrate`, vai trò `owner`; ghi danh sách tệp đã áp | dừng; `api`/`worker` chưa đổi |
| 4 | `rollout` | `helm upgrade --install --atomic --wait` với `image.digest` | Helm tự quay về bản trước |
| 5 | `web` | tải tệp có mã băm → `releases/<sha>/` → **cuối cùng** `index.html` | `helm rollback` + trả `index.html` |
| 6 | `smoke` | mục 5 | `helm rollback` + trả `index.html`; ghi "đã quay về" |
| 7 | `notify` | GitHub Deployment → trạng thái cuối; Telegram; (sửa nóng) mở pull request backmerge | không làm đổi kết quả triển khai |

Mọi bước chạy lại được an toàn (FR-037): ảnh dùng lại theo thẻ; Job migration theo tên + nhật ký
`infra.schema_migrations`; `helm upgrade` cùng digest là không đổi; tải tệp là ghi đè cùng nội dung.

Thời hạn: `rollout` ≤ 8 phút, `smoke` ≤ 3 phút → quay về bản trước xong trong ≤ 10 phút kể từ khi bắt đầu cập nhật
(SC-007).

## 3. Helm chart `ops/deploy/chart`

Giá trị đầu vào (từ `EnvironmentParams` + kết quả bước 2):

| Giá trị | Nguồn |
|---|---|
| `image.repository`, `image.digest` | bước `image` |
| `appVersion` | SHA commit (đặt nhãn `app.kubernetes.io/version`) |
| `replicas.api`, `replicas.worker` | tham số môi trường |
| `ingress.host` | `api.baseUrl` |
| `envFromSecret` | `secrets.app` (tên Secret) |
| `config.*` | biến không bí mật (`APP_ENV`, `CORS_ORIGINS`, trình điều khiển cổng…) |

Bất biến của chart:

- Hai Deployment `api` và `worker` dùng **cùng** `image.repository@image.digest`; khác nhau ở `command`.
- Không có `Secret` nào được định nghĩa trong chart; không có giá trị bí mật trong `values*.yaml`.
- Không Deployment nào gắn Secret `owner`; ứng dụng không chạy migration khi khởi động.
- `api`: `readinessProbe` `/readyz`, `livenessProbe` `/healthz`, `preStop` chờ 5 giây, `maxUnavailable: 0`.
- `worker`: `terminationGracePeriodSeconds: 40`, `SHUTDOWN_TIMEOUT_MS=30000`, dò sức khỏe ở cổng 3001.
- PDB `minAvailable: 1` cho từng Deployment; container chạy không phải root, hệ tệp gốc chỉ đọc.

Job migration (`ops/deploy/migrate-job.yaml`, ngoài chart): `backoffLimit: 0`, `ttlSecondsAfterFinished` 7 ngày,
`APP_ENV` của môi trường, biến `DATABASE_OWNER_URL` từ Secret `secrets.dbOwner`.

## 4. Giao diện web

Bố cục trong kho tệp tĩnh:

```text
index.html                      # con trỏ tới bản hiện hành – Cache-Control: no-cache
assets/<tên>.<băm>.<đuôi>       # dùng chung giữa các bản – immutable, 1 năm
releases/<sha>/index.html       # bản sao để quay về
releases/<sha>/manifest.json    # danh sách tệp assets của bản này + thời điểm
```

`publish-web.mjs --env <env> --sha <sha> [--activate | --rollback-to <sha>]`. Dọn dẹp (`maintenance/prune-web`): chỉ
xóa tệp `assets/` không thuộc manifest của bản hiện hành và của mọi bản được kích hoạt trong 7 ngày gần nhất.

## 5. Kiểm tra khói

`node ops/deploy/smoke/smoke.mjs --env <env> --expect-version <sha>` – mã thoát `0` khi mọi mục đạt; in một dòng
kết quả cho mỗi mục.

| Mục | Điểm cuối | Đạt khi |
|---|---|---|
| `api.health` | `GET {api}/healthz`, `/readyz` | 200, `version` = SHA mong đợi |
| `db+queue` | `POST {api}/ops/smoke` rồi `GET {api}/ops/smoke/{id}` (thăm dò ≤ 60 giây) | `processedAt` có giá trị, `apiVersion` = `workerVersion` = SHA mong đợi |
| `login` | điểm cuối đăng nhập / đăng xuất hiện có | đăng nhập tài khoản kiểm tra nội bộ thành công rồi đăng xuất |
| `web` | `GET {web}/` + tệp JS chính | 200 qua HTTPS; `index.html` khớp `releases/<sha>/index.html` |

Điểm cuối `ops/smoke`:

```text
POST /ops/smoke            Tiêu đề X-Smoke-Token   → 202 { "id": "<uuid>" }
GET  /ops/smoke/:id        Tiêu đề X-Smoke-Token   → 200 { "id", "requestedAt", "apiVersion",
                                                           "processedAt" | null, "workerVersion" | null }
Thiếu/sai mã                                       → 404 (không phân biệt với đường dẫn không tồn tại)
```

Khai báo truy cập `@Public` + bộ gác mã riêng (so sánh thời gian hằng); giới hạn 10 yêu cầu/phút mỗi bản API. Mã
đọc từ biến `SMOKE_TOKEN`; thiếu biến → điểm cuối luôn trả 404. Kiểm tra khói MUST NOT: tạo/sửa dữ liệu của tài
khoản khách hàng thật, gọi nền tảng mạng xã hội, gọi nhà cung cấp AI, gửi email (FR-032).

## 6. Triển khai lại bản cũ (FR-034)

`deploy/<env>/redeploy` – tham số: `VERSION` (SHA đã từng triển khai thành công lên môi trường này), `REASON`
(bắt buộc), `ACK_OLDER_THAN_PREVIOUS` (bắt buộc đánh dấu nếu `VERSION` không phải bản liền trước).

- Quyền chạy: `production` chỉ nhóm `release-managers`; `staging` thêm `developers`.
- Không dựng ảnh, không chạy migration; lấy digest từ `DeploymentRecord` của `VERSION`, kiểm ảnh còn trong kho.
- Chạy bước 4–7 như thường; `DeploymentRecord.kind = "redeploy"`, `redeploy.requestedBy` = người bấm.
- Cảnh báo trong job: tương thích ngược chỉ được kiểm với **bản liền trước**; bản cũ hơn cần SA tự đánh giá.

## 7. Sửa nóng và đưa về `dev`

Lần triển khai `production` được coi là sửa nóng khi pull request nguồn có nhánh `hotfix/*`
(`DeploymentRecord.kind = "hotfix"`). Sau bước 6 đạt: tạo nhánh `backmerge/<sha12>` từ đầu `master`, mở pull
request vào `dev` (tiêu đề "Backmerge sửa nóng <sha12>"), gắn nhãn `backmerge`; xung đột → thêm nhãn
`needs-manual-merge`. Đã tồn tại pull request cùng nhánh → không tạo trùng. Thời hạn: ≤ 10 phút sau khi triển khai
xong (SC-009).

## 8. Thông báo

Kênh: nhóm Telegram của đội (FR-044). Không gửi email. Khuôn tin:

```text
✅ staging · thành công · a1b2c3d4e5f6
Tác giả: <tên GitHub> · PR #123 · 9 phút
Migration: 1 · Lỗ hổng nghiêm trọng: 0
https://<ci-host>/job/deploy/job/staging/job/deploy/57/
```

| Kết quả | Biểu tượng + chữ | Thêm |
|---|---|---|
| thành công | `✅ … · thành công` | cảnh báo lỗ hổng (test), ngoại lệ đã dùng |
| hỏng trước khi đổi môi trường | `❌ … · hỏng ở bước <tên> (môi trường giữ nguyên)` | |
| đã quay về bản trước | `⚠️ … · ĐÃ QUAY VỀ BẢN TRƯỚC (hỏng ở <tên>)` | |
| chưa có môi trường đích | `ℹ️ … · chưa có môi trường đích` | |

`production` hỏng hoặc đã quay về: dòng đầu thêm `🚨 ƯU TIÊN CAO` và nhắc tên Telegram của người hợp nhất + nhóm
trực (`ops/ci/team.json`). Tin MUST NOT chứa bí mật, nhật ký thô, dữ liệu khách hàng, địa chỉ nội bộ ngoài đường
dẫn Jenkins (FR-044a). Gửi lỗi: thử lại 3 lần (5 s, 30 s, 120 s); vẫn lỗi → ghi `notifyErrors`, kết quả triển khai
không đổi.

## 9. Quét bí mật trong nhật ký chạy (FR-040)

Cuối mỗi lần chạy (cả hai chặng), nhật ký của lần chạy được xuất ra tệp và quét bằng
`node tooling/scan-secrets.mjs <tệp>`. Phát hiện → lần chạy bị đánh dấu không đạt, báo Telegram ưu tiên cao, và
tài liệu vận hành yêu cầu xoay thông tin liên quan. Mọi thông tin xác thực được nạp qua `withCredentials` (Jenkins
tự che trong nhật ký); các lệnh chạy với `set +x`.
