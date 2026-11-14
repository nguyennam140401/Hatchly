# Implementation Plan: Hạ tầng dưới dạng mã (Terraform) – môi trường thử nghiệm và môi trường phát hành

**Branch**: `impl/007-terraform-infra-environments` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-terraform-infra-environments/spec.md`

## Summary

Dựng hai môi trường `staging` và `production` tách hẳn trên VNG Cloud (ADR-11) từ **một bộ định nghĩa
Terraform, hai tệp tham số**; thêm môi trường tạm diễn tập khôi phục là tệp tham số thứ ba. Người vận hành là
một cá nhân nên mọi lớp an toàn nằm trong một lệnh duy nhất `pnpm infra …`, không nằm trong trí nhớ.

Cách làm chính (chi tiết và phương án đã loại ở [research.md](research.md)):

- **Hai stack cho mỗi môi trường**: `cloud` (lớp nhà cung cấp: mạng, cụm, nhóm máy, cân bằng tải, bucket) và
  `platform` (chỉ chuẩn Kubernetes: lối vào, chứng chỉ, CloudNativePG, chính sách mạng, tên bí mật). `platform`
  chỉ biết hợp đồng đầu ra của `cloud` → đổi nhà cung cấp là viết lại một module (R4).
- **Provider của VNG Cloud không có tài nguyên cho kho tệp, IAM, KMS, CDN, kho ảnh** (R1). Kho tệp quản lý qua
  giao diện S3; phần còn lại vào danh sách khởi tạo một lần, mỗi mục có phép kiểm tự động (R12).
- **Terraform không bao giờ giữ giá trị bí mật** – chỉ tên `Secret` và phân quyền đọc. Giá trị do
  `pnpm infra secrets` tạo thẳng trong cụm. Nhờ vậy trạng thái và bản xem trước đã lưu không có bí mật (R8).
- **CSDL**: CloudNativePG, PostgreSQL 17, lưu nhật ký giao dịch mỗi ≤ 5 phút ra bucket riêng; phát hành 2 bản,
  thử nghiệm 1 bản; biến thể được quản lý khai sẵn hợp đồng, chưa hiện thực (R6).
- **Giao diện tĩnh**: CDN kéo từ nguồn HTTP là `web` (nginx) trong cụm – không cần bucket công khai, chạy với
  mọi CDN (R7).
- **Ba lớp chặn lên phát hành** bằng dấu định nghĩa, bản xem trước đã lưu và bộ chặn tài nguyên chứa dữ liệu;
  kiểm tra tĩnh và kiểm tra lệch hằng ngày chạy trên GitHub Actions bằng chứng thực chỉ đọc, kiểm lệch hằng ngày chỉ cho stack `cloud` (R10, R13).
- **Tắt thử nghiệm** = gỡ nhóm máy, giữ phần điều khiển (miễn phí) cùng bí mật, chứng chỉ, địa chỉ (R11).

Hai phát hiện cần chủ dự án biết trước khi làm (cũng ghi ở Complexity Tracking):

1. Ảnh container hiện tại **không khởi động được với `APP_ENV=staging`** vì 005 cấm bản giả lập ở thử nghiệm
   mà chưa có bản thật nào. Kế hoạch thêm biến `STAGING_ALLOW_FAKES` (R15).
2. Tài liệu công khai **chưa cho thấy KMS của VNG Cloud có API mã hóa/giải mã** cho ứng dụng (V4). Đây là năng
   lực bắt buộc theo FR-033 và hiến pháp VII; phải hỏi khi xin báo giá. Không chặn việc viết mã hạ tầng.

## Technical Context

**Language/Version**: HCL – Terraform CLI ≥ 1.11, cố định một phiên bản trong `infra/.terraform-version`;
JavaScript (ESM, Node.js 24) cho CLI điều phối; YAML cho kê khai Kubernetes và GitHub Actions.

**Primary Dependencies** (đều cố định phiên bản – nguyên tắc IX):
- Provider Terraform: `vngcloud/vngcloud` `= 1.3.22`; `hashicorp/aws` (chỉ tài nguyên S3, trỏ vStorage);
  `hashicorp/kubernetes`; `hashicorp/helm`. Khóa bằng `.terraform.lock.hcl`.
- Biểu đồ Helm: NGINX Ingress Controller (F5/NGINX, bản mã nguồn mở), cert-manager, CloudNativePG + trình cắm
  Barman Cloud. Phiên bản chốt lúc implement, ghi trong `chart_versions`.
- Công cụ: `tflint`, `kubectl` (Kustomize đi kèm).
- Mới trong ứng dụng: không thư viện nào; một biến cấu hình `STAGING_ALLOW_FAKES`.

**Storage**: Không bảng CSDL mới. Trạng thái Terraform + bản ghi áp dụng/diễn tập trong bucket
`<prefix>-tfstate-<env>` (vStorage, trong nước). Bucket media và bucket sao lưu CSDL cho mỗi môi trường.
PostgreSQL 17 do CloudNativePG chạy trên cụm.

**Testing**:
- `terraform test` với `mock_provider` (bất biến của lớp nhà cung cấp, kiểm tra tham số) – không cần tài khoản.
- Vitest trong `tooling/test/infra/` cho CLI: bộ chặn a/b/c trên bản xem trước mẫu, dấu định nghĩa, so tham
  số, kiểm hai tệp quy trình không có `apply`.
- `pnpm infra check` gộp các bước trên, thêm vào `pnpm verify` (tự bỏ qua khi thiếu `terraform`).
- Trên môi trường thật: `pnpm infra smoke`, `bootstrap-check`, `dns-check`, `drill verify`
  ([quickstart.md](quickstart.md)).

**Target Platform**: VNG Cloud vùng trong nước – VKS (Kubernetes được quản lý), vStorage (S3), vLB, vCDN, KMS,
vCR. Máy người vận hành: Windows (PowerShell); hệ thống tự động: GitHub Actions (Linux).

**Project Type**: Hạ tầng dưới dạng mã + CLI vận hành, trong monorepo hiện có (`infra/`, `tooling/infra/`).

**Performance Goals**: dựng thử nghiệm từ tài khoản trống ≤ 2 giờ (SC-001); bật lại thử nghiệm ≤ 1 giờ
(FR-034); khôi phục CSDL ≤ 1 giờ, mất dữ liệu ≤ 5 phút (SC-006); tự phục hồi mất máy / mất bản chính ≤ 5 phút
(SC-007); phát hiện lệch ≤ 24 giờ (SC-011); `pnpm infra check` ≤ 3 phút.

**Constraints**:
- Dữ liệu lưu trữ chỉ ở vùng trong nước (ADR-10); tham số vùng ngoài danh sách bị từ chối.
- Hai môi trường không dùng chung chứng thực, khóa, đường mạng; ngoại lệ duy nhất là kho ảnh.
- Không bí mật trong kho mã, tệp tham số, trạng thái, bản xem trước, đầu ra, nhật ký.
- Quyền ghi lên phát hành chỉ ở máy người vận hành; quy trình không đòi người thứ hai.
- Không thêm dịch vụ ngoài bảng ngăn xếp của hiến pháp (FR-032).
- Chi phí thử nghiệm ≤ 40% phát hành khi bật suốt, ≤ 15% khi bật một phần tư thời gian (SC-012).
- Phần `platform` không dùng tính năng riêng của nhà cung cấp (FR-031).

**Scale/Scope**: 2 môi trường + 1 môi trường tạm; 2 stack; 3 module (`provider-vngcloud`, `platform-base`,
`database-cnpg`); 19 lệnh CLI; 2 quy trình tự động; 11 mục khởi tạo một lần cho mỗi môi trường; 14 điểm xác
minh P6; ~10 tài liệu vận hành. Tải giai đoạn 1: 100 tài khoản, CSDL vài GB, ~50 GB media (SC-014).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá | Bằng chứng |
|---|---|---|
| I. Cô lập tenant | ĐẠT | Không đổi mã tenant. Hạ tầng giữ ranh giới: bucket media riêng tư, quyền ứng dụng chỉ ở mức đối tượng (FR-018); bốn vai trò CSDL có bí mật riêng, `api` không nhận được `owner`/`system`, thực thi bằng RBAC (FR-014); dữ liệu phát hành không có đường sang thử nghiệm (SC-005) |
| II. Không đăng trùng | KHÔNG ÁP DỤNG | Không đụng luồng đăng. Hạ tầng hỗ trợ "không mất bài trong hàng chờ": CSDL có bản dự phòng, địa chỉ ổn định khi chuyển bản chính |
| III. Cổng AI + ngân sách | KHÔNG ÁP DỤNG | Không có lời gọi AI. Môi trường tạm diễn tập bị chặn đi ra nhà cung cấp AI |
| IV. Modular monolith | ĐẠT | Một ảnh, hai đơn vị triển khai `api`/`worker` (kê khai tạm và hợp đồng bàn giao); không tách dịch vụ. Thay đổi ứng dụng duy nhất nằm trong `core/config` |
| V. Việc nền bền vững | ĐẠT | Hàng chờ vẫn trong PostgreSQL; `worker` có `terminationGracePeriodSeconds: 35` cho tắt có kiểm soát 30 giây; tệp lớn đi thẳng lên kho tệp (CORS bucket chỉ cho nguồn gốc giao diện) |
| VI. AI đề xuất, người quyết | KHÔNG ÁP DỤNG | Không có giao diện khách hàng. Thông báo của CLI bằng tiếng Việt, mỗi lần chặn kèm việc cần làm |
| VII. Bí mật & dữ liệu cá nhân | ĐẠT CÓ ĐIỀU KIỆN | Dữ liệu ở vùng trong nước, kiểm bằng `validation` + `terraform test`; bí mật không vào Terraform (R8); khóa KMS riêng mỗi môi trường. **Điều kiện**: V4 (API mã hóa của KMS), V7 (mã hóa `Secret` khi lưu), V9 (đĩa mã hóa) phải đạt trước khi có dữ liệu thật; GitHub chỉ giữ chứng thực chỉ đọc, không dữ liệu cá nhân → không thêm bên nhận xuyên biên giới |
| VIII. Quan sát được | ĐẠT | Dành không gian tên, tài nguyên, lưu trữ cho H3; xuất tín hiệu hạn chứng chỉ, độ trễ sao lưu, chuyển bản chính; kiểm tra lệch báo qua issue; mỗi lần áp dụng lên phát hành có bản ghi |
| IX. Đơn giản, chuẩn mở | ĐẠT (có mục theo dõi) | Chỉ thành phần trong bảng ngăn xếp (Kubernetes, CloudNativePG, S3, CDN, KMS); phần riêng nhà cung cấp gom vào một module; phiên bản cố định; không thêm cache/hệ thống tin nhắn. Công cụ mới ở mức tối thiểu: Terraform + tflint + CLI Node; không Terragrunt, OPA, Vault. Lựa chọn nhà cung cấp có ADR-11. Sáu mục lệch ghi ở Complexity Tracking |

**Cổng chất lượng của hiến pháp**: quét bí mật mở rộng sang `infra/` (cổng CI số 5); "khôi phục CSDL diễn tập
mỗi quý ra môi trường riêng, đo thời gian" được hiện thực bằng lệnh `drill` và bản ghi diễn tập.

**Gate trước Phase 0**: ĐẠT.

**Re-check sau Phase 1**: ĐẠT – thiết kế không thêm vi phạm. Còn ba điều kiện bên ngoài (V2, V4, V9 – và V5
nếu thiếu lưu phiên bản/mã hóa) chặn việc **đưa dữ liệu khách hàng thật vào phát hành**, không chặn US1. Nếu V4
không đạt thì cần ADR mới trước khi tiếp tục với VNG Cloud; nếu V2 không đạt thì phải hỏi lại chủ dự án về
quyết định "một tài khoản".

Checklist kiến trúc (architecture.md mục 13): không bảng mới; không thêm hạ tầng ngoài bảng ngăn xếp; không
ghi bí mật vào nhật ký; thay đổi ứng dụng nằm trong `core/config`; thuật ngữ mới ghi ở
[data-model.md](data-model.md) mục 1 và sẽ thêm vào architecture.md mục 11 trong cùng thay đổi.

## Project Structure

### Documentation (this feature)

```text
specs/007-terraform-infra-environments/
├── plan.md
├── research.md                      # R1–R16 + danh sách xác minh P6 (V1–V13)
├── data-model.md                    # thực thể cấu hình, trạng thái, bản ghi, bí mật
├── quickstart.md                    # kiểm chứng theo US1–US4 và SC
├── adr-11-nha-cung-cap-ha-tang.md   # có sẵn
├── contracts/
│   ├── provider-layer.md            # hợp đồng lớp nhà cung cấp + bảng năng lực tối thiểu (FR-031, FR-033)
│   ├── environment-parameters.md    # lược đồ tệp tham số, khác biệt được phép (FR-003)
│   ├── handoff-outputs.md           # đầu ra → biến cấu hình ứng dụng, bí mật theo thành phần (FR-024, FR-014)
│   ├── infra-cli.md                 # lệnh pnpm infra, lớp chặn a/b/c, quy trình tự động (FR-026, FR-027)
│   └── one-time-bootstrap.md        # danh sách khởi tạo một lần + phép kiểm (FR-001, FR-023)
└── tasks.md                         # /speckit-tasks
```

### Source Code (repository root)

```text
infra/                                   # MỚI
├── .terraform-version · .tflint.hcl · README.md
├── modules/
│   ├── provider-vngcloud/               # LỚP NHÀ CUNG CẤP – nơi duy nhất có tài nguyên vngcloud_* và aws_s3_*
│   │   ├── network.tf · cluster.tf · node-groups.tf · load-balancer.tf
│   │   ├── buckets.tf · managed-db.tf   # managed-db: khai hợp đồng, chưa hiện thực (R6)
│   │   └── variables.tf · outputs.tf · versions.tf
│   ├── platform-base/                   # không gian tên, hạn mức, chính sách mạng, lối vào, cert-manager,
│   │   └── …                            #   ClusterIssuer, ServiceAccount + RBAC đọc Secret, hộp thư bắt giữ
│   └── database-cnpg/                   # toán tử, Cluster `pg`, kho sao lưu, ScheduledBackup, chế độ recovery
├── stacks/
│   ├── cloud/      { main.tf, variables.shared.tf, outputs.tf, backend.tf, versions.tf }
│   └── platform/   { main.tf, variables.shared.tf, outputs.tf, backend.tf, versions.tf }
├── envs/
│   ├── staging.tfvars · staging.backend.hcl · staging.bootstrap.json
│   ├── production.tfvars · production.backend.hcl · production.bootstrap.json
│   └── drill.tfvars.tmpl
├── tests/
│   ├── cloud/                           # chạy với stack cloud (terraform test -test-directory)
│   │   ├── provider-contract.tftest.hcl # bất biến provider-layer.md mục 4
│   │   ├── parameters.tftest.hcl        # validation của environment-parameters.md mục 3
│   │   └── drill-cloud.tftest.hcl · protected-coverage.tftest.hcl
│   ├── platform/                        # chạy với stack platform
│   │   └── platform.tftest.hcl · drill-platform.tftest.hcl · protected-coverage.tftest.hcl
│   └── fixtures/provider-stub/          # module nhà cung cấp giả để chứng minh SC-013
├── smoke-deploy/                        # TẠM – H2 thay và xóa
│   ├── base/ { api, worker, web, migrate-job, ingress }.yaml · kustomization.yaml
│   └── overlays/ { staging, production }/
├── docs/                                # FR-030, tiếng Việt
│   ├── 00-tong-quan.md · 01-khoi-tao-lan-dau.md · 02-dung-moi-truong.md · 03-dns-va-chung-chi.md
│   ├── 04-trien-khai-anh-va-kiem-tra-khoi.md · 05-quy-trinh-thay-doi.md · 06-bi-mat-va-khoa.md
│   ├── 07-khoi-phuc-csdl.md · 08-xu-ly-su-co.md · 09-tat-bat-thu-nghiem.md
│   ├── 10-chuyen-bien-the-csdl.md · 11-phu-thuoc-nha-cung-cap.md · ket-qua-kiem-chung.md
├── .credentials/.env.example            # thư mục bị gitignore trừ tệp mẫu
└── .plans/                              # gitignore

tooling/infra/                           # MỚI – CLI
├── cli.mjs                              # điểm vào `pnpm infra`
├── commands/ { check, bootstrap-check, plan, apply, up, outputs, dns-check, kubeconfig,
│               secrets, drift, power, smoke, drill, records }.mjs
└── lib/ { terraform.mjs, definition-hash.mjs, plan-guard.mjs, protected-resources.mjs,
           params-diff.mjs, records.mjs, credentials.mjs, s3.mjs, kube.mjs }
tooling/test/infra/                      # MỚI – Vitest: plan-guard, definition-hash, params-diff, workflows, handoff
tooling/scan-secrets.mjs                 # SỬA – đuôi .tf/.tfvars/.hcl; mẫu khóa S3 và khóa tài khoản dịch vụ
tooling/verify.mjs                       # SỬA – thêm bước `infra:check`

.github/workflows/                       # MỚI (thư mục chưa tồn tại)
├── infra-static.yml
└── infra-drift.yml

apps/server/src/core/config/             # SỬA – STAGING_ALLOW_FAKES (R15)
├── config.schema.ts · assert-no-fakes.ts · load-config.ts
apps/server/test/unit/                   # SỬA – ca kiểm cho staging có/không có cờ, production luôn từ chối
apps/server/.env.example                 # SỬA
apps/web/nginx.conf                      # SỬA – khối /api chỉ bật cho compose; thêm X-Robots-Tag theo biến
specs/005-gateway-contracts-fakes/contracts/runtime-config.md   # SỬA – ngoại lệ thử nghiệm
package.json                             # SỬA – script "infra"
.gitignore                               # SỬA – infra/.plans, infra/.credentials, .terraform/, *.tfplan, drill.tfvars
.specify/memory/architecture.md          # SỬA – mục 3 (hình thái thật), mục 11 (thuật ngữ), mục 12 (T4, T4c)
TaiLieuDacTa/ADR_…md, Lua_chon_Cong_nghe_…md   # SỬA ở repo chính – chép ADR-11, cập nhật T4/T5 (thư mục bị gitignore)
```

**Structure Decision**: Thư mục `infra/` mới ở gốc kho mã, tách khỏi `ops/` (hiện chứa luật cảnh báo và script
dev). Bên trong tách ba tầng theo hướng phụ thuộc: `modules/provider-*` (riêng nhà cung cấp) ← `stacks/cloud`;
`modules/platform-base`, `modules/database-cnpg` (chuẩn mở) ← `stacks/platform`; `envs/` chỉ có dữ liệu. CLI
đặt ở `tooling/infra/` cạnh các công cụ `.mjs` sẵn có để dùng chung Vitest, ESLint và `pnpm verify`. Bộ kê
khai `infra/smoke-deploy/` là tạm thời và thuộc về H2 khi H2 bắt đầu.

## Phases (cho /speckit-tasks)

0. **Nền, không cần tài khoản đám mây**: `git merge dev`; khung `infra/`, phiên bản, `.gitignore`; khung CLI +
   `pnpm infra check`; mở rộng quét bí mật; `infra-static.yml`; biến `STAGING_ALLOW_FAKES` + kiểm thử + cập
   nhật hợp đồng 005; soạn thư gửi VNG Cloud theo danh sách V1–V13.
1. **US1 (P1) – thử nghiệm**: `provider-vngcloud` (mạng, cụm, nhóm máy, cân bằng tải, bucket) + kiểm thử hợp
   đồng; stack `cloud`; `platform-base`; `database-cnpg`; stack `platform`; lệnh `bootstrap-check`, `plan`,
   `apply`, `up`, `kubeconfig`, `secrets`, `outputs`, `dns-check`; `smoke-deploy` + lệnh `smoke`; tài liệu
   00–04, 06; dựng thật khi có tài khoản; lệnh `power` + tài liệu 09 (FR-034).
2. **US2 (P2) – phát hành**: tham số phát hành + `validation`; bảo vệ xóa; trải bản trên các máy; phép thử cô
   lập chéo trong `smoke`; phép thử mất máy / mất bản chính; ghi kết quả.
3. **US3 (P3) – thay đổi có kiểm soát**: dấu định nghĩa, bản ghi áp dụng, lớp chặn a/b/c + kiểm thử đơn vị;
   lệnh `drift`, `records`; `infra-drift.yml` + issue; tài liệu 05, 08.
4. **US4 (P4) – diễn tập**: `environment_kind = restore_drill` trong hai stack; chế độ `recovery` của
   `database-cnpg`; lệnh `drill`; chạy với `--from staging`; tài liệu 07.
5. **Hoàn thiện**: tài liệu 10, 11; cập nhật `architecture.md`; chép ADR-11 vào `TaiLieuDacTa/` và cập nhật
   T4/T5 (ở repo chính); `pnpm verify`; rà hiến pháp; cập nhật FR-001 và Key Entities theo Complexity Tracking.

Giai đoạn 0 và phần viết mã của giai đoạn 1–4 làm được trước khi P6 xong (kiểm bằng `terraform test`); các
bước "dựng thật" chờ tài khoản.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Danh sách khởi tạo một lần dài hơn câu chữ FR-001 (thêm: project, tài khoản dịch vụ + chính sách, khóa S3, khóa KMS, điểm phân phối CDN, kho ảnh + robot) | Provider Terraform của VNG Cloud không có tài nguyên cho IAM, KMS, CDN, kho ảnh (R1) | Bọc API bằng `local-exec`: không có trạng thái, không phát hiện lệch, công viết lớn cho việc làm một lần. Bù lại: mỗi mục tay có phép kiểm tự động (`bootstrap-check`). **Cần cập nhật FR-001** |
| Thử nghiệm được chạy bản giả lập bằng `STAGING_ALLOW_FAKES` – đổi luật của 005 "staging/production từ chối bản giả lập" | FR-029 đòi thử nghiệm chạy bản giả lập theo mặc định; hiện không có bản thật nào nên ảnh không khởi động được ở thử nghiệm (R15) | Chạy thử nghiệm với `APP_ENV=development`: mở điểm cuối quản trị giả lập ra internet và làm thử nghiệm khác phát hành. Chờ bản thật: chặn cổng chuyển đợt 1. Giới hạn: phát hành bỏ qua biến; `/dev/fakes` vẫn đóng |
| Không tạo "kho giao diện tĩnh" (Key Entities); giao diện phục vụ từ `web` (nginx) trong cụm qua CDN | vCDN chưa xác minh đọc được bucket riêng tư và có luật trả tệp vào; SC-009 cấm bucket công khai (R7) | Bucket công khai cho giao diện: trái SC-009. Chờ V3: chặn US1. Xem lại khi V3 đạt |
| Hộp thư bắt giữ (Mailpit) chỉ có ở thử nghiệm – một thành phần không có ở phát hành, ngoài danh sách khác biệt của FR-003 | FR-029 đòi email thử nghiệm đi vào hộp thư bắt giữ | Dùng SES sandbox: vẫn gửi ra ngoài tới địa chỉ đã xác minh, và phụ thuộc P5. Bật bằng tham số, bị ép `false` ở phát hành |
| Thêm GitHub Actions (hai quy trình) trước khi có H2 | FR-027 đòi kiểm tra tĩnh và kiểm tra lệch chạy tự động trong tính năng này | Lịch trên máy người vận hành: không chạy khi máy tắt, không đạt "≤ 24 giờ". CronJob trong cụm: môi trường tự kiểm chính nó, và thử nghiệm tắt thì không chạy. Giới hạn chấp nhận: chỉ kiểm lệch stack `cloud` (API cụm chỉ mở cho `admin_cidrs`); stack `platform` kiểm trên máy người vận hành |
| Review do chính người vận hành thực hiện – hiến pháp đòi "mọi thay đổi qua review" | Chỉ có một người (Clarifications 2026-11-13) | Người thứ hai duyệt: không có người. Thay bằng ba lớp chặn công cụ + bản ghi áp dụng làm bằng chứng. Xem lại khi có người vận hành thứ hai |
