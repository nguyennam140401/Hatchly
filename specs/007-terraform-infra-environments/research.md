# Research: Hạ tầng Terraform – môi trường thử nghiệm và phát hành

**Ngày**: 2026-11-13 · **Đầu vào**: [spec.md](spec.md), [adr-11-nha-cung-cap-ha-tang.md](adr-11-nha-cung-cap-ha-tang.md),
hiến pháp, `.specify/memory/architecture.md` mục 3.

Nguồn tra cứu là tài liệu công khai của VNG Cloud (nay đổi tên GreenNode, `docs.greennode.ai`) và Terraform
Registry, đọc ngày 2026-11-13. **Chưa có tài khoản và chưa có báo giá**, nên mọi điểm tài liệu không nói rõ
được ghi thành mục xác minh P6 (mục cuối) kèm phương án dự phòng. Không còn mục NEEDS CLARIFICATION: mỗi điểm
đã có quyết định; điểm nào phụ thuộc xác minh thì quyết định nêu rõ nhánh dự phòng.

---

## R1. Provider Terraform của VNG Cloud phủ tới đâu

**Dữ kiện.** Provider `vngcloud/vngcloud`, bản mới nhất 1.3.22 (2026-10-08). Danh sách tài nguyên trong kho mã
của provider (`docs/resources`, 40 tệp) chỉ gồm 4 nhóm:

| Nhóm | Tài nguyên có | Dùng cho |
|---|---|---|
| `vserver_*` | network, subnet, secgroup, secgrouprule, route_table, volume, sshkey, server… | Mạng riêng, nhóm bảo mật |
| `vks_*` | `vks_cluster`, `vks_cluster_node_group` | Cụm và nhóm máy |
| `vlb_*` | loadbalancer, listener, pool, policy, certificate | Cân bằng tải |
| `vdb_*` | `vdb_postgresql_cluster`, backup, config group… | CSDL được quản lý (biến thể sau) |

**Không có** tài nguyên Terraform cho: kho tệp vStorage, vCDN, dịch vụ quản lý khóa (KMS), kho ảnh vCR, IAM
(tài khoản dịch vụ, chính sách), project.

**Quyết định.**

- Mạng, nhóm bảo mật, cụm, nhóm máy, cân bằng tải: provider `vngcloud/vngcloud`, cố định `= 1.3.22`.
- Kho tệp: quản lý qua **giao diện S3** bằng provider `hashicorp/aws` (chỉ dùng các tài nguyên `aws_s3_bucket*`,
  trỏ `endpoints.s3` về vStorage, tắt mọi kiểm tra tài khoản AWS). Tài liệu vStorage xác nhận tạo bucket, lưu
  phiên bản, luật vòng đời, CORS, bucket policy đều làm được qua công cụ S3 bên thứ ba (xác minh V5).
- IAM, khóa KMS, kho ảnh, điểm phân phối CDN, project: **không tự động hóa được bằng Terraform** trên VNG Cloud
  hôm nay → đưa vào **danh sách khởi tạo một lần** (R12), mỗi mục có bước kiểm tra tự động.

**Lý do.** Giao diện S3 là chuẩn mở (nguyên tắc IX), nên phần kho tệp của lớp nhà cung cấp gần như dùng lại
được khi đổi nhà cung cấp. Viết provider riêng hoặc bọc API bằng script `local-exec` cho IAM/KMS/CDN là công
lớn, dễ hỏng, không tương xứng với một người vận hành.

**Phương án đã loại.** (a) `local-exec` gọi API cho mọi thứ thiếu: không có trạng thái, không phát hiện lệch.
(b) Provider cộng đồng cho S3 (`aminueza/minio`): gắn với MinIO, không phải vStorage. (c) Chờ provider bổ
sung: không có lộ trình công khai.

**Hệ quả với đặc tả.** FR-001 liệt kê danh sách khởi tạo một lần là "tài khoản, hạn mức, nơi lưu trạng thái,
bản ghi DNS". Danh sách thực tế dài hơn (R12). Đây là lệch so với câu chữ của FR-001, ghi ở Complexity
Tracking của plan; cần cập nhật FR-001 khi rà đặc tả.

## R2. Công cụ và phiên bản

**Quyết định.**

- **Terraform CLI ≥ 1.11**, cố định đúng một phiên bản trong `infra/.terraform-version` và `required_version`
  (chọn bản ổn định mới nhất lúc bắt đầu implement). Cần ≥ 1.11 vì: khóa trạng thái bằng tệp khóa trên S3
  (`use_lockfile`, R3) và `terraform test` với `mock_provider` (R10).
- Provider cố định bằng `.terraform.lock.hcl` (commit vào kho mã): `vngcloud/vngcloud`, `hashicorp/aws`,
  `hashicorp/kubernetes`, `hashicorp/helm`.
- **Không dùng provider `random` cho mật khẩu** (R8).
- Script điều phối viết bằng **Node.js (`.mjs`)** trong `tooling/infra/`, gọi qua `pnpm infra …`. Máy người
  vận hành là Windows, hệ thống tự động chạy Linux; kho mã đã có Node 24 và các công cụ `tooling/*.mjs` cùng
  kiểu, nên không thêm ngôn ngữ script thứ hai.
- Công cụ phụ: `tflint` (cố định phiên bản), `kubectl`, `helm` (provider helm tự mang), AWS CLI chỉ dùng trong
  hướng dẫn khởi tạo nơi lưu trạng thái.

**Phương án đã loại.** OpenTofu: tương đương về tính năng cần dùng, nhưng tài liệu và ví dụ của VNG Cloud viết
cho Terraform, và người vận hành đang học – giữ đúng công cụ của tài liệu. Terragrunt/Terraform Cloud: thêm
công cụ và (với Terraform Cloud) đưa trạng thái ra nước ngoài, trái FR-005. Bash/PowerShell: phải viết hai
bản hoặc ép cài thêm trên một trong hai hệ điều hành.

## R3. Trạng thái hạ tầng

**Quyết định.** Backend `s3` của Terraform trỏ về vStorage.

- Mỗi môi trường **một bucket trạng thái riêng** trong project của chính nó (`<prefix>-tfstate-staging`,
  `<prefix>-tfstate-production`), tạo ở bước khởi tạo một lần, bật lưu phiên bản, riêng tư.
- Mỗi môi trường tách **hai tệp trạng thái** theo hai tầng (R4): `cloud.tfstate`, `platform.tfstate`. Môi
  trường tạm diễn tập dùng khóa `drill/cloud.tfstate`, `drill/platform.tfstate` trong bucket của môi trường mà
  nó thuộc về.
- Khóa: `use_lockfile = true` (ghi có điều kiện `If-None-Match` lên S3). Cần xác minh vStorage hỗ trợ (V6).
  **Dự phòng** nếu không hỗ trợ: script `pnpm infra` tự tạo đối tượng khóa `locks/<stack>.json` trước khi chạy
  và từ chối khi đã có; rủi ro còn lại (hai lệnh cùng tạo khóa trong cùng mili giây) chấp nhận được với một
  người vận hành, ghi trong tài liệu.
- Trạng thái **không chứa bí mật** (hệ quả của R8), nên tài khoản chỉ đọc của kiểm tra lệch đọc được trạng
  thái mà không lộ gì.
- Cùng bucket có tiền tố `records/` (bản ghi áp dụng, bản ghi diễn tập) và `runtime/` (trạng thái bật/tắt).

**Phương án đã loại.** Backend `pg`: CSDL nằm trong chính hạ tầng đang dựng. Backend `kubernetes`: cùng vấn đề,
và mất khi dựng lại cụm. Trạng thái cục bộ: trái FR-005. Một bucket chung cho hai môi trường: tài khoản dịch
vụ của thử nghiệm sẽ cần quyền trên bucket chứa trạng thái phát hành, trái FR-023.

## R4. Bố cục mã: lớp nhà cung cấp, tầng nền tảng, hai stack

**Vấn đề.** Provider `kubernetes`/`helm` cần địa chỉ và chứng thực của cụm lúc lập kế hoạch; nếu cụm được tạo
trong cùng lần `apply`, lần chạy đầu và mọi lần thay thế cụm đều lỗi hoặc cho bản xem trước sai.

**Quyết định.** Hai stack gốc, mỗi môi trường chạy lần lượt:

1. **`cloud`** – gọi module **lớp nhà cung cấp** (`modules/provider-vngcloud`): mạng, nhóm bảo mật, cụm, nhóm
   máy, cân bằng tải (nếu V8 đạt), các bucket. Đầu ra theo hợp đồng cố định
   ([contracts/provider-layer.md](contracts/provider-layer.md)).
2. **`platform`** – chỉ dùng chuẩn Kubernetes: không gian tên, lối vào, cert-manager, toán tử và cụm
   CloudNativePG, chính sách mạng, hạn mức, tên bí mật, hộp thư bắt giữ. Đọc đầu ra của `cloud` qua
   `terraform_remote_state`.

Hai môi trường và môi trường tạm dùng **cùng hai stack**, khác nhau ở tệp tham số `envs/<tên>.tfvars` và tệp
cấu hình backend `envs/<tên>.backend.hcl`. Không có thư mục mã riêng cho từng môi trường → SC-004 kiểm được
bằng cách so hai tệp tham số.

Đổi nhà cung cấp = viết `modules/provider-<khác>` theo cùng hợp đồng và đổi một dòng `source` trong stack
`cloud`; stack `platform` không đổi (FR-031, SC-013).

**Phương án đã loại.** Một stack duy nhất: gặp đúng vấn đề nêu trên. Thư mục riêng cho từng môi trường chép
mã: lệch dần giữa hai môi trường. Workspace của Terraform: dùng chung backend và chứng thực, trái FR-002.

## R5. Cụm Kubernetes và lối vào

**Dữ kiện.** VKS: phần điều khiển miễn phí; `vks_cluster` có `enable_private_cluster`, `white_list_node_cidr`
(giới hạn địa chỉ được gọi phần điều khiển), `enabled_load_balancer_plugin`, `enabled_block_store_csi_plugin`,
mạng `CALICO` (có NetworkPolicy). Nhóm máy riêng tư cần tự dựng cổng NAT (tài liệu gợi ý pfSense). Cụm riêng tư
tốn thêm 4 điểm cuối dịch vụ. Tài liệu VKS hướng dẫn cấp chứng chỉ bằng NGINX Ingress Controller (bản của
F5/NGINX) + cert-manager + Let's Encrypt HTTP-01.

**Quyết định.**

- **Cụm công khai + danh sách địa chỉ được phép** (`admin_cidrs` trong tệp tham số) cho phần điều khiển (FR-009).
  Nhóm máy công khai, nhóm bảo mật chỉ mở cổng từ cân bằng tải; không mở SSH.
- Nhóm máy là tài nguyên tách khỏi cụm (khuyến nghị của tài liệu: nhóm máy khai trong cụm thì không gỡ được).
- **Lối vào**: NGINX Ingress Controller của F5/NGINX (bản mã nguồn mở, biểu đồ Helm cố định phiên bản) sau cân
  bằng tải tầng 4. Ứng dụng chỉ khai tài nguyên `Ingress` chuẩn, nên đổi bộ điều khiển không đụng H2.
  Không dùng `kubernetes/ingress-nginx` của cộng đồng: dự án đã ngừng bảo trì (tháng 3/2026).
- **Chứng chỉ**: cert-manager (cố định phiên bản biểu đồ) + Let's Encrypt, HTTP-01. Tự gia hạn; chỉ số
  `certmanager_certificate_expiration_timestamp_seconds` là tín hiệu cho H3 cảnh báo trước 14 ngày.
- **Địa chỉ công khai cố định**: tạo cân bằng tải bằng Terraform ở stack `cloud` rồi gắn dịch vụ của lối vào
  vào nó, để địa chỉ sống qua lần dựng lại cụm (xác minh V8). **Dự phòng**: để trình cắm của VKS tự tạo cân
  bằng tải từ `Service type=LoadBalancer`; địa chỉ giữ nguyên chừng nào dịch vụ còn (phần điều khiển không bị
  hủy khi tắt thử nghiệm – R11), nhưng dựng lại cụm thì phải sửa bản ghi DNS, ghi trong hướng dẫn.
- **Không gian tên**: `app`, `database`, `monitoring` (dành cho H3: chỉ tạo tên, hạn mức, lớp lưu trữ),
  `ingress`, `cert-manager`, `cnpg-system`; thử nghiệm thêm `mail-capture`.
- **Chính sách mạng**: mặc định từ chối vào trong `database`; chỉ `app` và `monitoring` được vào cổng 5432.

**Kích thước khởi đầu** (ADR-11; con số chốt lại sau báo giá, chỉ đổi tệp tham số):

| | Thử nghiệm | Phát hành |
|---|---|---|
| Nhóm máy | 1 máy 4 vCPU / 8 GB | 2 máy 4 vCPU / 8 GB, trải vùng sẵn sàng nếu có |
| Đĩa máy | 50 GB | 80 GB |

Ngân sách tài nguyên trên một máy 4/8: `api` 2 × (0,25 CPU / 512 MB), `worker` 2 × (0,5 CPU / 1,5 GB, đĩa tạm
4 GB cho video 500 MB – FR-010), PostgreSQL 1 CPU / 2 GB, lối vào + cert-manager + toán tử ~0,5 CPU / 600 MB,
còn ~1,5 GB cho giám sát rút gọn ở thử nghiệm. Phát hành có 2 máy nên giám sát đầy đủ của H3 vừa. Các con số
`requests/limits` là khuyến nghị bàn giao cho H2 ([contracts/handoff-outputs.md](contracts/handoff-outputs.md)).

**Phương án đã loại.** Cụm riêng tư + nhóm máy riêng tư: an toàn hơn nhưng phải tự vận hành máy NAT và trả tiền
điểm cuối – trái mục tiêu ít công vận hành của ADR-11; xem lại khi có người vận hành thứ hai. Bộ điều khiển
lối vào riêng của VNG (vLB tầng 7): gắn nhà cung cấp, chứng chỉ phải tải lên cân bằng tải.

## R6. CSDL: CloudNativePG

**Quyết định.**

- Toán tử CloudNativePG cài bằng Helm (cố định phiên bản biểu đồ); mỗi môi trường một `Cluster`:
  PostgreSQL **17** (trùng `docker-compose.yml`; cùng phiên bản chính ở hai môi trường – FR-011), phát hành 2
  bản (1 chính + 1 dự phòng tự lên thay, trải hai máy bằng `podAntiAffinity`), thử nghiệm 1 bản.
- **Địa chỉ ổn định**: dịch vụ `pg-rw.database.svc` – không đổi khi chuyển bản chính (FR-011, SC-007).
- **Sao lưu**: trình cắm Barman Cloud của CloudNativePG (cách sao lưu trong toán tử đã bị đánh dấu ngừng) ghi
  vào bucket **riêng** `<prefix>-db-backup-<env>`. `archive_timeout = 5min` → mất dữ liệu ≤ 5 phút. Bản chụp
  hằng ngày bằng `ScheduledBackup`. Giữ theo cửa sổ khôi phục: phát hành **30 ngày** (thỏa cả "khôi phục 7
  ngày" lẫn "giữ bản chụp 30 ngày" của FR-013 bằng một chính sách; CSDL vài GB nên chi phí lưu nhỏ), thử
  nghiệm **3 ngày**.
- **Mã hóa**: đường truyền – CloudNativePG tự cấp chứng chỉ, `pg_hba` chỉ nhận `hostssl`; khi lưu – loại đĩa
  có mã hóa của nhà cung cấp (V9) và mã hóa phía máy chủ của bucket sao lưu.
- **Số kết nối** (FR-015), tính từ `.env.example`:

  | Bên dùng | Mỗi bản | Số bản | Tổng |
  |---|---|---|---|
  | `api`: bể `app` 10 + hàng chờ 2 + `support` 10 | 22 | 2 | 44 |
  | `worker`: bể `app` 20 + `system` 20 + điều khiển hàng chờ 6 | 46 | 2 | 92 |
  | Migration | | | 2 |
  | Giám sát + toán tử + sao chép | | | 10 |
  | **Cần** | | | **148** |

  Dư ≥ 30% → `max_connections = 220`. Không dùng bộ gom kết nối ở giai đoạn 1 (không cần ở mức này; tránh rủi
  ro với biến phiên phạm vi giao dịch và `LISTEN/NOTIFY`).
- **Vai trò**: hạ tầng chỉ cấp tài khoản quản trị (bí mật `db-admin`, chỉ tác vụ migration đọc). Bốn vai trò
  `owner/app/system/support` vẫn do `db:bootstrap` của ứng dụng tạo (Assumptions).
- **Biến thể được quản lý** (FR-012): tham số `db_variant = "cnpg" | "managed"`. `managed` dùng
  `vngcloud_vdb_postgresql_cluster` trong lớp nhà cung cấp và stack `platform` chỉ tạo một dịch vụ
  `ExternalName` cùng tên `pg-rw` → ứng dụng vẫn dùng một địa chỉ. Tính năng này **cài đặt và kiểm thử nhánh
  `cnpg`**; nhánh `managed` khai sẵn biến và hợp đồng, chỉ hiện thực khi V1 đạt (tránh viết mã chưa chạy được).

**Phương án đã loại.** Sao lưu `pg_dump` theo lịch: không đạt mất dữ liệu ≤ 5 phút. Bộ gom PgBouncer ngay từ
đầu: thêm thành phần khi chưa có nhu cầu (nguyên tắc IX).

## R7. Kho tệp, giao diện tĩnh và CDN

**Kho tệp** (mỗi môi trường, provider `aws` trỏ vStorage – R1):

| Bucket | Cấu hình |
|---|---|
| `<prefix>-media-<env>` | Riêng tư; lưu phiên bản; phiên bản cũ xóa sau 7 ngày; dọn tải nhiều phần dở sau 7 ngày; CORS chỉ cho nguồn gốc giao diện của môi trường (PUT/POST/GET/HEAD); luật xóa đối tượng nhãn `lifecycle=tmp` sau 1 ngày |
| `<prefix>-db-backup-<env>` | Riêng tư; chỉ danh tính sao lưu CSDL ghi được; không CORS |
| `<prefix>-tfstate-<env>` | Tạo tay một lần (R3); Terraform không quản lý |

- Luật vòng đời **lọc theo nhãn đối tượng**: tài liệu vStorage chỉ nêu lọc theo tiền tố (V5). Tệp tạm nằm ở
  `tenants/{acc}/tmp/{jobId}/…` nên không lọc theo tiền tố được. **Dự phòng**: việc dọn dẹp hằng ngày của
  Worker (đã có trong kiến trúc, mục 6 "Dọn dẹp … tệp tạm") là cơ chế chính; SC-010 "≤ 2 ngày" vẫn đạt. **Lưu ý**: việc dọn tệp tạm của Worker chưa có trong mã hiện tại – là phụ thuộc mở với tính năng media về sau; `smoke` kiểm riêng lưu phiên bản và ba luật vòng đời của bucket media.
- **Quyền của ứng dụng** (FR-018): một tài khoản dịch vụ `app-<env>` + khóa S3, bucket policy chỉ cho
  `Get/Put/Delete/Tagging` đối tượng trên bucket media; không có quyền cấu hình bucket; không có trong policy
  của bucket sao lưu và bucket trạng thái. Danh tính sao lưu CSDL là tài khoản dịch vụ khác.

**Giao diện tĩnh.** FR-019 đòi: qua CDN, HTTPS, tệp băm tên cache 1 năm, `index.html` không cache dài, đường
dẫn lạ trả tệp vào. Tài liệu vCDN không cho biết có đọc được bucket riêng tư hay có luật viết lại cho ứng
dụng một trang không; còn SC-009 cấm mọi bucket đọc công khai.

**Quyết định.** CDN kéo từ **nguồn HTTP** là dịch vụ `web` (nginx) chạy trong cụm – chính ảnh
`apps/web/Dockerfile` đã có, `nginx.conf` của nó đã đặt đúng ba luật cache và luật trả `index.html`. CDN chỉ
tôn trọng tiêu đề cache của nguồn. Cách này chạy với mọi CDN (nguồn HTTP là năng lực phổ quát – FR-031), không
cần bucket công khai, không phụ thuộc năng lực viết lại của CDN.

- Thay đổi nhỏ ở `apps/web/nginx.conf`: khối chuyển tiếp `/api` chỉ dùng cho docker compose; ở môi trường thật
  giao diện gọi thẳng tên miền `api.` (CORS đã có). Bàn giao cho H2 trong hợp đồng đầu ra.
- Hệ quả: thực thể "kho giao diện tĩnh" trong đặc tả **không được tạo** ở phương án này; ghi ở Complexity
  Tracking. Xem lại khi V3 xác nhận CDN đọc được bucket riêng tư và có luật trả tệp vào.

**Media xem trước qua CDN** (FR-020): vCDN có "Security Link" (đường dẫn có băm + thời hạn) nhưng công thức và
việc dùng với nguồn S3 riêng tư chưa xác minh (V3). **Quyết định**: bật theo tham số
`media_cdn_enabled` (mặc định `false`): media xem trước đi thẳng từ kho tệp bằng đường dẫn ký sẵn – đúng
nhánh dự phòng FR-020 đã nêu, và ứng dụng hôm nay cũng chỉ có đường này.

**Chứng chỉ của tên miền trên CDN**: vCDN có mục quản lý chứng chỉ; chưa rõ có tự cấp/tự gia hạn (V3). Dự
phòng theo thứ tự: (1) CDN tự cấp; (2) cert-manager cấp cho tên miền giao diện (HTTP-01 đi xuyên CDN về nguồn)
rồi một CronJob đẩy lên CDN qua API; (3) chứng chỉ mua 1 năm, nhắc gia hạn bằng lịch – ghi trong hướng dẫn.

## R8. Bí mật: Terraform chỉ biết tên, không biết giá trị

**Vấn đề.** Mật khẩu sinh bằng provider `random` nằm dạng rõ trong trạng thái **và trong tệp bản xem trước đã
lưu** – trong khi FR-026 buộc lưu bản xem trước và FR-022 cấm bí mật xuất hiện trong bản xem trước.

**Quyết định.**

- Terraform **không tạo và không đọc giá trị bí mật nào**. Stack `platform` chỉ khai *tên* các `Secret`, phân
  quyền đọc (RBAC theo `ServiceAccount` của `api` / `worker` / `migrate`) và xuất tên ra đầu ra bàn giao.
- Giá trị do lệnh `pnpm infra secrets init <env>` tạo trực tiếp trong cụm: sinh ngẫu nhiên (32 byte,
  `node:crypto`) cho mật khẩu 4 vai trò CSDL và `AUTH_THROTTLE_SECRET`; **chỉ tạo khi chưa có** (chạy lại an
  toàn); không in giá trị. Bí mật do bên ngoài cấp (khóa S3, SMTP, AI, Meta, Zalo) nhập bằng
  `pnpm infra secrets set <env> <tên>` – đọc từ bàn phím không hiện chữ, không qua tham số dòng lệnh, không qua
  kho mã (FR-022).
- **Kho bí mật** = `Secret` của Kubernetes trong không gian tên `app` và `database`. VNG Cloud không có dịch vụ
  kho bí mật trong tài liệu công khai. Assumptions của đặc tả đòi `Secret` "được mã hóa khi lưu bằng khóa của
  dịch vụ quản lý khóa": VKS quản lý phần điều khiển, tài liệu không nói về mã hóa etcd bằng khóa khách hàng
  (V7). Dự phòng nếu không có: giữ `Secret` thường + RBAC hẹp + nhật ký truy cập của cụm, ghi rủi ro còn lại
  vào tài liệu và ADR-11.
- Ba `Secret` theo thành phần để thực thi FR-014 bằng RBAC chứ không bằng quy ước:

  | Secret | Ai đọc | Chứa |
  |---|---|---|
  | `api-secrets` | `api` | `DATABASE_APP_URL`, `DATABASE_SUPPORT_URL`, `AUTH_THROTTLE_SECRET`, `SMTP_URL`, khóa S3 |
  | `worker-secrets` | `worker` | `DATABASE_APP_URL`, `DATABASE_SYSTEM_URL`, `SMTP_URL`, khóa S3 |
  | `migrate-secrets` | tác vụ migration | `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_*` |

**Phương án đã loại.** `random_password` + `sensitive`: vẫn nằm trong tệp bản xem trước. Thuộc tính chỉ-ghi
(write-only) của Terraform 1.11: provider `kubernetes` chưa hỗ trợ đều cho `Secret`. External Secrets + Vault
tự chạy: thêm một dịch vụ phải vận hành (nguyên tắc IX; ADR-11 đã loại việc tự chạy dịch vụ khóa). SOPS trong
kho mã: bí mật (dù mã hóa) vào lịch sử git, thêm việc quản lý khóa giải mã.

## R9. Khóa mã hóa (FR-021)

**Dữ kiện.** VNG Cloud có "Key Management System": khóa do khách hàng quản lý tạo trên bảng điều khiển, khóa
đối xứng hoặc bất đối xứng, có trạng thái, xóa có thời gian chờ 7–30 ngày, nhập vật liệu khóa từ ngoài. Tài
liệu công khai **không mô tả** API mã hóa/giải mã cho ứng dụng, xoay khóa tự động, hay nhật ký dùng khóa.
Provider Terraform không có tài nguyên KMS.

**Quyết định.**

- Mỗi môi trường **một khóa đối xứng do khách hàng quản lý**, tạo ở bước khởi tạo một lần; định danh khóa đưa
  vào tệp tham số (không phải bí mật) và xuất ở đầu ra bàn giao. Quyền dùng khóa: chỉ tài khoản dịch vụ
  `app-<env>`.
- Hợp đồng lớp nhà cung cấp chỉ khai **đầu vào** `kms_key_id` và kiểm tra định dạng; việc gọi KMS thuộc module
  `platform_gateway` (WBS sau), ngoài phạm vi.
- **V4 là điểm xác minh chặn** cho P6: KMS có API mã hóa/giải mã (hoặc sinh khóa dữ liệu) gọi được bằng tài
  khoản dịch vụ, có xoay khóa giữ phiên bản cũ, có nhật ký dùng khóa. Hiến pháp VII đòi "khóa của dịch vụ
  quản lý khóa" và FR-033 xếp dịch vụ quản lý khóa là năng lực **bắt buộc**. Nếu V4 không đạt thì theo đặc tả
  nhà cung cấp bị loại; phương án giữ VNG Cloud bằng dịch vụ khóa tự chạy (ví dụ OpenBao transit) cần **ADR
  mới** vì ADR-11 đã loại việc tự chạy dịch vụ khóa. Tính năng này không tự quyết thay.

Việc viết mã Terraform không bị chặn bởi V4 (khóa không nằm trong Terraform); việc **đưa mã quyền thật** vào
môi trường thì bị chặn.

## R10. Kiểm tra tĩnh và kiểm tra lệch (FR-027)

**Kiểm tra tĩnh** – chạy không cần tài khoản đám mây, lệnh `pnpm infra check`:

| Bước | Công cụ | Bắt được |
|---|---|---|
| Định dạng | `terraform fmt -check -recursive` | Sai định dạng |
| Hợp lệ | `terraform init -backend=false` + `terraform validate` cho từng stack | Sai cú pháp, sai tham chiếu |
| Lint | `tflint` | Biến không dùng, thiếu kiểu, thiếu phiên bản |
| Luật an toàn | `terraform test` với `mock_provider` | Bucket có ACL/policy công khai; CORS `*`; CSDL có địa chỉ công khai; vùng ngoài danh sách (FR-007); thiếu nhãn (FR-006); cụm không có danh sách địa chỉ được phép; `production` thiếu bảo vệ xóa; thiếu luật vòng đời/lưu phiên bản |
| So tham số | script | Khóa nào trong `production.tfvars` khác `staging.tfvars` mà ngoài danh sách FR-003 → lỗi (SC-004) |
| Bí mật | `pnpm check:secrets` mở rộng cho `.tf`, `.tfvars`, `.hcl` + mẫu khóa S3/khóa dịch vụ VNG | Bí mật trong mã (SC-008) |

Bước này thêm vào `pnpm verify`; tự bỏ qua kèm lý do khi máy chưa cài `terraform` (cùng cơ chế `SKIPPED:` đã
có).

**Vì sao `terraform test` thay cho Checkov/Trivy/OPA.** Các bộ luật có sẵn viết cho AWS/GCP/Azure, không có
luật nào cho tài nguyên `vngcloud_*`; đằng nào cũng phải tự viết luật. `terraform test` đi kèm Terraform, không
thêm công cụ và ngôn ngữ (Rego).

**Kiểm tra lệch** – `pnpm infra drift <env>`: `terraform plan -detailed-exitcode -lock=false` trên cả hai
stack bằng chứng thực **chỉ đọc**; mã thoát 2 = lệch.

**Chạy tự động**: GitHub Actions (kho mã ở GitHub; chưa có quy trình CI nào – H2 sẽ thêm phần ứng dụng).

- `infra-static.yml`: chạy `pnpm infra check` trên mỗi thay đổi đụng `infra/**` hoặc `tooling/infra/**`.
- `infra-drift.yml`: lịch hằng ngày 06:00 (UTC+7) + chạy tay; mỗi môi trường một việc, dùng bí mật của
  "GitHub Environment" tương ứng: tài khoản dịch vụ chỉ đọc + khóa S3 chỉ đọc bucket trạng thái. Chỉ kiểm
  stack `cloud` (xem bullet "Phạm vi" bên dưới); không có kubeconfig trên GitHub.
- **Báo cho người vận hành**: lệch hoặc lần chạy lỗi → việc thất bại (GitHub tự gửi email cho chủ kho) và mở
  hoặc cập nhật một issue `infra-drift:<env>` kèm danh sách tài nguyên lệch. Hết lệch thì tự đóng issue.
- **Phạm vi lệch trên GitHub (quyết định 2026-11-13)**: điểm quản trị cụm chỉ mở cho `admin_cidrs` (FR-009) nên máy chạy của GitHub không gọi được API cụm. Quy trình tự động chỉ kiểm stack `cloud` – nơi có mọi thứ sửa được trên bảng điều khiển (SC-011). Stack `platform` được kiểm ở đầu mỗi lệnh `plan` và bằng `pnpm infra drift <env>` trên máy người vận hành; lệch trong cụm vì vậy không được phát hiện trong 24 giờ – giới hạn đã chấp nhận, khuyến nghị chạy tay hằng tuần. Muốn phủ cả hai thì cần máy chạy tự quản có địa chỉ cố định (thêm chi phí và công vận hành).
- Môi trường đang tắt vẫn kiểm tra được: trạng thái tắt là một tham số (R11), bản xem trước vẫn phải rỗng.

GitHub nằm ở nước ngoài nhưng chỉ giữ chứng thực **chỉ đọc**, không có dữ liệu khách hàng, và trạng thái không
chứa bí mật (R8) → không thêm bên nhận dữ liệu cá nhân xuyên biên giới; quyền ghi lên phát hành không rời máy
người vận hành (FR-026).

## R11. Tắt/bật thử nghiệm (FR-034)

**Quyết định.** Tham số `powered` (mặc định `true`). `pnpm infra power staging off|on` áp dụng stack `cloud`
với giá trị mới và ghi `runtime/power.json` vào bucket trạng thái để mọi lệnh sau (xem trước, kiểm tra lệch)
dùng đúng giá trị.

| Khi tắt | |
|---|---|
| Bị gỡ | Nhóm máy (`count = 0`) → không còn máy tính phí |
| Được giữ | Phần điều khiển cụm (miễn phí) cùng mọi đối tượng trong nó: `Secret`, chứng chỉ, cấu hình lối vào, định nghĩa CSDL; cân bằng tải và địa chỉ công khai; các bucket; khóa mã hóa; điểm phân phối CDN; bản ghi DNS |
| Dữ liệu CSDL | Đĩa của CSDL được giữ mặc định (tiền đĩa nhỏ). Đặt `staging_keep_db_volume = false` thì gỡ cả đĩa; bật lại sẽ dựng từ migration + dữ liệu mẫu (FR-034 cho phép) |

Bật lại: tạo nhóm máy (~10–15 phút) → các `Deployment` tự lên → trong ngân sách 1 giờ. Địa chỉ không đổi nên
không phải sửa DNS hay cấu hình phía Meta.

Chi phí khi tắt = cân bằng tải + đĩa + bucket. Giá cân bằng tải lúc rảnh chưa có (V10); nếu đẩy chi phí vượt
15% của SC-012 thì phương án là gỡ cả cân bằng tải và chấp nhận sửa một bản ghi DNS khi bật – quyết sau báo giá.

`powered = false` bị từ chối với `environment = "production"` (kiểm tra `validation` của biến). Trong thời gian
Meta xét duyệt: đặt `power_lock = true` trong `staging.tfvars`, lệnh `power off` từ chối.

**Phương án đã loại.** Hủy cả môi trường thử nghiệm khi không dùng (ý ban đầu của ADR-11): mất `Secret`, chứng
chỉ, địa chỉ công khai → mỗi lần bật phải nhập lại bí mật và sửa DNS, trái FR-034. Tự thu nhóm máy về 0 bằng
bộ tự mở rộng: tài liệu không xác nhận cho phép 0 máy; `count = 0` chạy được trong cả hai trường hợp.

## R12. Danh sách khởi tạo một lần và kiểm tra tự động

Những thứ Terraform không tạo được trên VNG Cloud (R1) hoặc phải có trước Terraform. Chi tiết từng bước ở
[contracts/one-time-bootstrap.md](contracts/one-time-bootstrap.md).

| Phạm vi | Mục |
|---|---|
| Tài khoản | Mở tài khoản, bật xác thực hai lớp cho tài khoản gốc, hạn mức, nhật ký hoạt động quản trị (V14) |
| Dùng chung | Kho ảnh vCR + 3 tài khoản robot: `push`, `pull-staging`, `pull-production` |
| Mỗi môi trường | Project; tài khoản dịch vụ `terraform-<env>` (ghi), `drift-<env>` (chỉ đọc), `app-<env>`, `dbbackup-<env>` + chính sách; khóa S3 tương ứng; bucket trạng thái; khóa KMS; điểm phân phối CDN + tên miền; bản ghi DNS (FR-001) |

Lệnh `pnpm infra bootstrap-check <env>` kiểm từng mục bằng chính các chứng thực vừa tạo (đọc được bucket trạng
thái, liệt kê được project, tài khoản chỉ đọc **không** ghi được, tài khoản của môi trường này **không** thấy
tài nguyên môi trường kia – SC-005) và in mục nào còn thiếu. `pnpm infra dns-check <env>` so bản ghi DNS thực
với giá trị mong đợi từ đầu ra (FR-001).

**Kho ảnh** (FR-009): vCR có tài khoản robot theo kho. Luật thẻ ảnh không ghi đè được chưa thấy trong tài liệu
(V11). Bất kể kết quả: tài liệu triển khai và hợp đồng bàn giao **buộc tham chiếu ảnh bằng digest**
(`image@sha256:…`) – digest không thể bị ghi đè, và bảo đảm phát hành chạy đúng ảnh đã kiểm ở thử nghiệm kể cả
khi kho ảnh không có luật bất biến.

**Tách quyền theo project** (FR-023): chính sách IAM của VNG gồm sản phẩm / hành động / tài nguyên / điều kiện;
tài liệu không nói rõ giới hạn theo project (V2). Dự phòng nếu không giới hạn được: tách hai môi trường ra
**hai tài khoản gốc** (đi ngược câu trả lời Clarifications "một tài khoản" → phải hỏi lại chủ dự án, không tự
quyết).

## R13. An toàn thay đổi lên phát hành (FR-025, FR-026)

Ba điều kiện kiểm bằng lệnh `pnpm infra`, không bằng tài liệu. Chi tiết: [contracts/infra-cli.md](contracts/infra-cli.md).

- **Dấu định nghĩa** = SHA-256 trên nội dung `infra/modules/**`, `infra/stacks/**`, `.terraform.lock.hcl`
  (không gồm tệp tham số). Cây git phải sạch; commit được ghi lại.
- **(a) Đã chạy ở thử nghiệm**: `apply staging` thành công ghi `records/applied/<dấu>.json` vào bucket trạng
  thái thử nghiệm. `plan production` từ chối nếu không tìm thấy bản ghi cho đúng dấu hiện tại. Thay đổi **chỉ**
  ở `production.tfvars` (ví dụ tăng kích thước máy) không đổi dấu → qua (a) nhưng vẫn chịu (b), (c); giới hạn
  này ghi rõ trong tài liệu kèm khuyến nghị thử tham số tương đương ở thử nghiệm trước.
- **(b) Chỉ đúng bản đã lưu**: `plan production` ghi `infra/.plans/production/<stack>.tfplan` (bị gitignore) +
  `meta.json` (dấu định nghĩa, băm tệp tham số, commit, thời điểm, tóm tắt). `apply production` chỉ nhận tệp
  đó, tính lại hai giá trị băm, hết hạn sau 24 giờ; Terraform tự từ chối bản xem trước cũ hơn trạng thái.
  Bản xem trước không chứa bí mật (R8) nên lưu được (SC-008).
- **(c) Chặn xóa/thay thế tài nguyên chứa dữ liệu**: đọc `terraform show -json`, đối chiếu danh sách loại tài
  nguyên được bảo vệ (bucket media/sao lưu, `Cluster` CSDL và đĩa của nó, CSDL được quản lý, không gian tên
  `database`). Có thao tác `delete`/`replace` → dừng, in danh sách. Đi tiếp cần **hai bước tách rời** (FR-025):
  (1) một thay đổi riêng đặt `deletion_protection = false` cho đúng tài nguyên đó, đã áp dụng; (2) lần áp dụng
  có `--confirm-data-loss` và gõ lại tên môi trường. Cả hai được ghi vào bản ghi áp dụng.
- **Bản ghi áp dụng** (`records/applied/…` của phát hành): thời điểm, commit, dấu định nghĩa, tóm tắt
  tạo/sửa/xóa, có dùng xác nhận mất dữ liệu không (SC-011).
- Lớp bảo vệ của nhà cung cấp bổ sung: lưu phiên bản bucket; khóa KMS xóa có thời gian chờ ≥ 7 ngày.

**Phương án đã loại.** `lifecycle.prevent_destroy`: không tham số hóa được theo môi trường (thử nghiệm phải
hủy được), và gỡ nó là sửa mã dùng chung. OPA/Conftest cho luật (c): thêm công cụ cho một luật vài chục dòng.

## R14. Môi trường tạm diễn tập khôi phục (FR-028, US4)

**Quyết định.** Không viết stack riêng: môi trường tạm là **tệp tham số thứ ba** `envs/drill.tfvars` (sinh từ
mẫu bởi `pnpm infra drill start --from <env> --target-time <t>`) chạy cùng hai stack, với
`environment_kind = "restore_drill"`:

| Khác với môi trường thường | |
|---|---|
| Mạng | Mạng và cụm riêng trong project của môi trường nguồn; 1 máy |
| Lối vào | Không tạo lối vào, không cân bằng tải, không địa chỉ công khai |
| Đi ra ngoài | `NetworkPolicy` + nhóm bảo mật chỉ cho đi tới điểm cuối kho tệp và kho ảnh; không SMTP, không Meta/Zalo/AI |
| CSDL | `Cluster` khởi tạo ở chế độ `recovery` từ bucket sao lưu của môi trường nguồn, tới `target_time`; **không** bật sao lưu của chính nó |
| Quyền | Khóa S3 của tài khoản dịch vụ `drill-<env>`: **chỉ đọc** bucket sao lưu; không có trong policy của bucket media; không có quyền dùng khóa KMS |
| Ứng dụng | Không triển khai `api`/`worker` |

`pnpm infra drill verify` chạy truy vấn kiểm tra (dòng đánh dấu), đo thời gian từ lúc bắt đầu tới lúc truy vấn
được, ghi `records/drills/<ngày>.json` (thời điểm khôi phục về, thời gian đo, kết quả, người thực hiện).
`pnpm infra drill destroy` hủy cả hai stack và kiểm không còn tài nguyên mang nhãn `environment=drill`.

Diễn tập với dữ liệu phát hành chạy trong project phát hành (Clarifications); kịch bản kiểm thử độc lập của
US4 chạy cùng lệnh với `--from staging`.

## R15. Chạy được ở thử nghiệm với bản giả lập (FR-029) – cần sửa ứng dụng

**Vấn đề phát hiện khi lập kế hoạch.** Tính năng 005 đặt luật: `APP_ENV ∈ {staging, production}` thì từ chối
mọi bản giả lập (`assert-no-fakes.ts`), mà hiện các cổng **chỉ có** bản `fake`. Nghĩa là ảnh container hiện
tại **không khởi động được** với `APP_ENV=staging`. FR-029 của đặc tả này lại yêu cầu thử nghiệm chạy bản giả
lập theo mặc định cho đến khi có bản thật.

**Quyết định.** Thêm một biến cho phép có chủ đích, chỉ có hiệu lực ở thử nghiệm:

- `STAGING_ALLOW_FAKES=true` + `APP_ENV=staging` → cho phép `*_DRIVER=fake` với `FAKE_STATE_STORE=sandbox`;
  ghi cảnh báo `gateways.fakes_enabled_in_staging` lúc khởi động. `APP_ENV=production` bỏ qua biến này và
  **vẫn từ chối**. `STORAGE_DRIVER=memory` và `MAIL_TRANSPORT=memory` vẫn bị từ chối ở thử nghiệm (kho tệp và
  SMTP là bản thật).
- Tác vụ migration ở thử nghiệm áp thêm migration `sandbox` khi biến bật; điểm cuối `/dev/fakes` **không** mở
  ở thử nghiệm (thử nghiệm truy cập công khai).
- Email thử nghiệm: Mailpit chạy trong không gian tên `mail-capture` (chỉ khi `mail_capture_enabled = true`,
  bị từ chối ở phát hành), giao diện xem thư không mở ra internet (xem qua `kubectl port-forward`).
- `X-Robots-Tag: noindex` đặt ở lối vào và ở `web` khi `search_indexing = false` (bắt buộc `false` ở thử nghiệm).

Đây là thay đổi hành vi của 005 (SC-006 của 005) → ghi Complexity Tracking; cập nhật
`specs/005-gateway-contracts-fakes/contracts/runtime-config.md` và `.env.example` trong cùng thay đổi.

**Phương án đã loại.** Chạy thử nghiệm với `APP_ENV=development`: mở điểm cuối quản trị giả lập ra internet,
tắt các kiểm tra bắt buộc của môi trường thật, và thử nghiệm không còn giống phát hành. Chờ có bản thật mới
dựng thử nghiệm: chặn cổng chuyển đợt 1 của WBS.

## R16. Triển khai tay để kiểm tra khói (US1)

Tự động hóa triển khai thuộc H2. Để US1 kiểm được, tính năng này có một bộ kê khai **tối thiểu, tạm thời** ở
`infra/smoke-deploy/` (Kustomize đi kèm `kubectl`, không thêm công cụ): `Deployment` `api` ×2, `worker` ×2,
`web` ×2, `Job` migration, `Ingress`. H2 thay bộ này và xóa nó. `pnpm infra smoke <env>` chạy bộ kiểm tra khói
của SC-003 (kiểm tra sức khỏe, ghi–đọc CSDL bằng `app`, tải tệp 100 MB bằng đường dẫn ký sẵn, mở giao diện
qua HTTPS, HTTP → HTTPS).

---

## Danh sách xác minh P6 (gửi VNG Cloud cùng lúc xin báo giá)

"Chặn" = chưa có câu trả lời đạt thì không đưa dữ liệu khách hàng thật vào. Không mục nào chặn việc viết mã
và kiểm tra tĩnh.

| Mã | Câu hỏi | Ảnh hưởng | Nếu không đạt | Chặn |
|---|---|---|---|---|
| V1 | vDB PostgreSQL có lưu nhật ký giao dịch liên tục + khôi phục về thời điểm bất kỳ? | Chỉ nhánh `db_variant = managed` | Giữ CloudNativePG (đang là mặc định) | Không |
| V2 | Chính sách IAM giới hạn được tài khoản dịch vụ trong **một project** (vServer, VKS, vStorage)? Có chính sách chỉ đọc? | FR-023, SC-005 | Tách hai tài khoản gốc – hỏi lại chủ dự án | **Có** (phát hành) |
| V3 | vCDN: tên miền riêng + chứng chỉ tự cấp/gia hạn? Nguồn là bucket riêng tư được không? Luật trả tệp vào? Security Link dùng với media? Có API? | FR-019, FR-020 | Nguồn HTTP trong cụm (đang là mặc định); media không qua CDN; chứng chỉ theo thứ tự dự phòng ở R7 | Không |
| V4 | KMS có API mã hóa/giải mã cho ứng dụng bằng tài khoản dịch vụ, xoay khóa giữ phiên bản cũ, nhật ký dùng khóa? | FR-021, hiến pháp VII | Nhà cung cấp không đạt năng lực bắt buộc → ADR mới | **Có** (mã quyền thật) |
| V5 | vStorage HCM04 qua API S3: `PutBucketVersioning`, `PutBucketLifecycleConfiguration` (lọc theo **nhãn**, hết hạn phiên bản cũ, dọn tải dở), `PutBucketCors`, `PutBucketPolicy`, POST policy, tải nhiều phần, mã hóa khi lưu mặc định? | FR-016, FR-017 | Lọc theo nhãn → việc dọn của Worker; mục khác không đạt thì cấu hình tay + kiểm bằng `bootstrap-check` | **Có** nếu thiếu lưu phiên bản hoặc mã hóa khi lưu |
| V6 | vStorage hỗ trợ ghi có điều kiện `If-None-Match` (khóa trạng thái Terraform)? | FR-005 | Khóa bằng script (R3) | Không |
| V7 | VKS mã hóa `Secret` trong etcd khi lưu? Bằng khóa KMS của khách hàng được không? Có nhật ký truy cập API của cụm? | FR-022 | Ghi rủi ro còn lại; RBAC hẹp (đã chấp nhận 2026-11-13: mã quyền nền tảng được mã hóa ở tầng ứng dụng; trong `Secret` chỉ có mật khẩu CSDL và khóa S3) | Không |
| V8 | Gắn được dịch vụ `LoadBalancer` của cụm vào một cân bằng tải tạo sẵn (giữ địa chỉ qua dựng lại cụm)? | FR-034, DNS tay | Để trình cắm tự tạo; dựng lại cụm thì sửa DNS | Không |
| V9 | Loại đĩa có mã hóa khi lưu cho VKS? Lớp lưu trữ nào? | FR-011 | Mã hóa tầng tệp của PostgreSQL không có sẵn → ghi rủi ro, hỏi lại | **Có** (phát hành) |
| V10 | Giá: máy theo giờ, cân bằng tải, đĩa, vStorage, băng thông ra, vCDN theo GB, KMS; ưu đãi tài khoản mới | SC-012, kích thước | Điều chỉnh tham số; xem lại R11 | Không |
| V11 | vCR: luật thẻ ảnh không ghi đè; tài khoản robot chỉ kéo | FR-009 | Buộc dùng digest (đã là mặc định) | Không |
| V12 | Số vùng sẵn sàng tại vùng chọn; cam kết khả dụng của VKS | FR-008, 99,5% | Trải trên các máy khác nhau; ghi rủi ro | Không |
| V13 | Nhóm máy `num_nodes = 0` / xóa nhóm máy khi cụm còn: phần điều khiển có tính phí không? | FR-034 | Xem lại R11 | Không |
| V14 | Tài khoản có nhật ký hoạt động quản trị (ai, làm gì, lúc nào)? Giữ bao lâu? | FR-023 | Ghi rủi ro còn lại; thao tác quản trị chỉ truy được qua bản ghi áp dụng | Không |

## Nguồn

- https://registry.terraform.io/providers/vngcloud/vngcloud (1.3.22, 2026-10-08)
- https://github.com/vngcloud/terraform-provider-vngcloud (`docs/resources`, `docs/data-sources`)
- https://docs.greennode.ai/vks/su-dung-vks-voi-terraform
- https://docs.greennode.ai/vks/clusters/public-cluster-and-private-cluster.md
- https://docs.greennode.ai/vks/network/working-with-alb/automatically-manage-certificates-in-vks-with-nginx-ingress-controller-cert-manager-and-lets-encr.md
- https://docs.greennode.ai/vks/node-groups/auto-scaling.md
- https://docs.greennode.ai/vstorage/object-storage/object-storage-hcm04/ (bucket-lifecycle, working-with-service-account, working-with-buckets-via-3rd-party-software)
- https://docs.greennode.ai/key-management-system.md · https://docs.greennode.ai/key-management-system/customer-managed-key.md
- https://docs.greennode.ai/vcdn.md · https://docs.greennode.ai/vcdn/chi-tiet-tinh-nang/security-link.md
- https://docs.greennode.ai/vcontainer-registry.md
- https://docs.greennode.ai/identity-and-access-management-iam/quan-ly-truy-cap-iam/quan-ly-truy-cap-qua-policy.md
