# Implementation Plan: Quy trình tích hợp và triển khai tự động (Jenkins) cho hai môi trường test và release

**Branch**: `impl/008-cicd-jenkins-pipeline` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-cicd-jenkins-pipeline/spec.md`

## Summary

Đưa `pnpm verify` thành cổng chất lượng bắt buộc chặn hợp nhất vào `dev` / `master`, và tự triển khai sau hợp nhất
(`dev` → `staging`, `master` → `production`) do Jenkins điều phối (WBS H2). Hướng kỹ thuật (research R1–R23):

- **Một nguồn sự thật cho cổng**: mọi kiểm tra nằm trong `tooling/verify.mjs` (thêm `--ci`, `--only`, `--report`,
  ngoại lệ); `Jenkinsfile` chỉ gọi lệnh và đăng kết quả lên GitHub Checks. Năm cổng mới: `check:release-source`,
  `db:immutable`, `db:compat`, `check:image`, `check:pipeline`; bổ sung bao phủ truy cập chéo theo catalog.
- **Jenkins trên một máy ảo riêng** ngoài hai cụm, cấu hình hoàn toàn bằng mã (JCasC + Job DSL), hai tác nhân tách
  người dùng hệ điều hành: `ci` chạy mã chưa review và không có thông tin triển khai; `deploy` chạy mã đã hợp nhất.
  Thông tin xác thực đặt theo thư mục job nên test và release không dùng chéo được.
- **Triển khai**: một ảnh mỗi commit (thẻ = SHA, triển khai theo digest) → Job migration tường minh bằng vai trò
  `owner` ở namespace riêng → `helm upgrade --atomic` cho `api` + `worker` → giao diện web (`index.html` cuối cùng)
  → kiểm tra khói qua HTTPS → GitHub Deployment + Telegram. Hỏng thì quay về bản ứng dụng trước; CSDL chỉ đi tới.
- **Không phụ thuộc 007 để bắt đầu**: `provisioned: false` cho phép US1 và phần dựng ảnh hoàn tất trước khi có môi
  trường; những gì 008 cần từ 007 nằm ở [contracts/environment-inputs.md](./contracts/environment-inputs.md).

## Technical Context

**Language/Version**: TypeScript 5.9.3 / Node.js 24 (pnpm 10.34.9) cho công cụ (`tooling/*.mjs`, `ops/**/*.mjs`) và
phần mã ứng dụng thêm vào; Groovy khai báo (Declarative Pipeline, Job DSL); HCL (Terraform) cho máy ảo; YAML (JCasC,
Helm chart, tham số môi trường); Bash cho `bootstrap.sh`.

**Primary Dependencies**: Jenkins LTS + phần mở rộng ở [contracts/jenkins-platform.md](./contracts/jenkins-platform.md)
mục 4; Docker rootless + buildx; Helm; kubectl; Trivy; `gh` CLI (áp ruleset); `@aws-sdk/client-s3` (đã có trong kho
mã). Phiên bản chính xác và mã băm cố định lúc implement trong `ops/ci/versions.env`, `plugins.txt` và digest ảnh
(R19) – kế hoạch không ghi số phiên bản chưa kiểm chứng. Không thêm phụ thuộc chạy nào vào `api` / `worker`.

**Storage**: Không có CSDL riêng cho quy trình. Lịch sử triển khai = GitHub Deployments (`DeploymentRecord`) + nhật ký
Jenkins 400 ngày; ảnh ở kho ảnh của từng môi trường; giao diện ở kho tệp tĩnh S3. CSDL ứng dụng thêm đúng một bảng
dùng chung `infra.smoke_pings` (data-model.md mục 8). Cổng chất lượng dùng PostgreSQL tạm (container), hủy sau mỗi
lần chạy.

**Testing**: Vitest cho công cụ mới (`tooling/test/`), `test:db` / `test:queue` cho phần CSDL và hàng chờ;
`check:pipeline` (`helm lint`, `helm template`, lược đồ tham số, phiên bản cố định); bộ năm vi phạm cài sẵn + yêu cầu
sạch đối chứng (SC-002); các phép thử trên Jenkins và môi trường thật ở [quickstart.md](./quickstart.md).

**Target Platform**: Máy ảo Ubuntu LTS trên đám mây trong nước (Jenkins); hai cụm Kubernetes được quản lý của 007
(`staging`, `production`); GitHub (kho riêng tư, Checks, Deployments, rulesets); Telegram Bot API (chỉ thông báo).

**Project Type**: Hạ tầng quy trình (CI/CD) cho ứng dụng web modular monolith; phần mã ứng dụng thêm rất nhỏ (điểm
cuối `ops/smoke`, việc `queue.smoke_ping`).

**Performance Goals**: kết quả cổng trên pull request ≤ 15 phút p95 (SC-003, ba làn song song); hợp nhất → test đã
qua kiểm tra khói ≤ 25 phút p95; hợp nhất → release ≤ 30 phút p95 (SC-004); tự quay về bản trước ≤ 10 phút (SC-007:
`rollout` ≤ 8 phút + `smoke` ≤ 3 phút); thông báo ≤ 5 phút; dựng lại Jenkins ≤ 4 giờ (SC-014).

**Constraints**: mã chưa review không chạm thông tin triển khai và không ghi kho ảnh (FR-038); Jenkins không có đường
mạng tới CSDL / kho tệp media / KMS (FR-041) và không giữ mật khẩu `owner` (FR-039); không kiểm tra nào chỉ tồn tại
trong `Jenkinsfile` (FR-007); trên Jenkins bước bị bỏ qua là không đạt (FR-008); migration chỉ đi tới; mọi bước triển
khai chạy lại được (FR-037); không thêm dịch vụ nào ngoài Jenkins (FR-047); phiên bản mọi thành phần ngoài cố định.

**Scale/Scope**: đội 3–4 người, ước tính 10–30 pull request/tuần; 1 máy ảo (8 vCPU · 16 GB · 200 GB, điều chỉnh sau
khi đo); 2 môi trường; 17 cổng (5 mới); 3 `Jenkinsfile`; 1 Helm chart; 1 bảng + 2 điểm cuối + 1 loại việc trong ứng
dụng; 8 tài liệu vận hành tiếng Việt (FR-046); 1 ADR.

Không còn mục NEEDS CLARIFICATION: năm câu hỏi đã chốt ở Clarifications 2026-11-13; các lựa chọn kỹ thuật ở
research.md. Hai việc **xác nhận** còn mở không chặn thiết kế nhưng chặn implement – xem mục Rủi ro (R-1, R-2).

## Constitution Check

*GATE: đánh giá trước Phase 0 và đánh giá lại sau Phase 1 – cả hai lần ĐẠT, có hai mục cần biện minh (Jenkins là dịch
vụ mới – nguyên tắc IX; chưa có người review thứ hai khi kho chỉ có một thành viên), ghi ở Complexity Tracking và
ADR-11.*

| Nguyên tắc | Đánh giá | Bằng chứng trong thiết kế |
|---|---|---|
| I. Cô lập tenant | ĐẠT (tăng cường) | `test:db` thành cổng chặn hợp nhất, **không cho ngoại lệ** (R17); bao phủ lấy từ catalog sau migrate, phủ cả khung nhìn hỗ trợ, hàm `SECURITY DEFINER`, bảng việc (R10; FR-013…016). Bảng mới `infra.smoke_pings` là bảng dùng chung, không chứa dữ liệu khách hàng, `support` không có quyền. Kiểm tra khói dùng tài khoản nội bộ dành riêng, không chạm tài khoản khách hàng. Jenkins không có đường mạng và không có thông tin vào CSDL / kho tệp media. |
| II. Đăng bài tin cậy | ĐẠT (gián tiếp) | Tính năng không đăng bài. Bảo vệ luồng đăng khi phát hành: `maxUnavailable: 0`, Worker dừng có kiểm soát 30 giây trong `terminationGracePeriodSeconds: 40`, việc dạng lạ sau khi quay về bản cũ được trả lại hàng chờ chứ không chôn (R22). Kiểm tra khói MUST NOT gọi nền tảng mạng xã hội. |
| III. Cổng AI & ngân sách | Không áp dụng | Không gọi AI; kiểm tra khói không gọi nhà cung cấp AI (FR-032). |
| IV. Ranh giới module | ĐẠT | `check:boundaries` là cổng bắt buộc (FR-011, FR-012). Mã ứng dụng mới nằm trọn trong module `queue` (schema `infra`), không thêm phụ thuộc giữa module; ghi dòng `smoke_pings` và tạo việc trong cùng giao dịch. Một ảnh, hai đơn vị triển khai, cùng digest (ADR-01; `check:image` chạy ba vai). |
| V. Việc nền bền vững | ĐẠT | Bộ xử lý `queue.smoke_ping` cập nhật có điều kiện `WHERE processed_at IS NULL` → chạy lại an toàn, có kiểm thử chạy hai lần. Triển khai không làm mất / chạy trùng việc (FR-030, SC-006). Không thêm hàng chờ ngoài pg-boss. |
| VI. AI đề xuất, người quyết định | ĐẠT | Người quyết định phát hành = người có vai `release-manager` hợp nhất pull request vào `master` (kèm người khác tác giả duyệt khi kho có từ hai thành viên – FR-004); ngoại lệ vượt cổng do SA/PO duyệt với tư cách chủ mã. `POST /ops/smoke` là `@Public` có bộ gác mã riêng kiểm ở API (so sánh thời gian hằng, sai → 404, giới hạn tốc độ). Thông điệp cổng không đạt bằng tiếng Việt, kèm lệnh chạy lại (FR-010). Không có giao diện khách hàng mới. |
| VII. Bí mật & dữ liệu cá nhân | ĐẠT | Bí mật không nằm trong kho mã, ảnh, chart, nhật ký, tin nhắn (FR-040; `check:secrets` + quét nhật ký mỗi lần chạy, cả hai không cho ngoại lệ). Mật khẩu `owner` chỉ ở Secret của namespace migration; `ci-deployer` không có quyền `secrets`, `pods/exec`. Máy Jenkins, kho ảnh, nhật ký chạy đặt trong nước (ADR-10). GitHub và Telegram chỉ nhận mã nguồn và siêu dữ liệu triển khai, **không có dữ liệu khách hàng**; hai bên nhận này được ghi vào danh sách chuyển dữ liệu xuyên biên giới (ghi chú: quy trình phát triển) và trong ADR-11. Trivy chạy cục bộ. |
| VIII. Quan sát được | ĐẠT | Mỗi lần triển khai có `DeploymentRecord` (ai hợp nhất, ai duyệt, commit, digest, migration, từng bước, quay về, ngoại lệ) giữ ngoài đĩa Jenkins (R14; FR-043, SC-011). `api` / `worker` báo `version`. Thao tác quản trị trên Jenkins và lần bị từ chối ghi bằng Audit Trail 12 tháng. Cảnh báo vận hành của ứng dụng thuộc WBS H3 – ngoài phạm vi. |
| IX. Đơn giản, chuẩn mở | ĐẠT có biện minh | Jenkins là dịch vụ mới phải vận hành → **ADR-11** + Complexity Tracking. Ngoài Jenkins không thêm dịch vụ chạy: Helm, Trivy, kubectl là công cụ dòng lệnh; loại Argo CD / Flux, VPN, Ansible, máy ảo thứ hai. Mọi thành phần ngoài cố định phiên bản + digest (R19, `check:pipeline`). Chuẩn mở: Kubernetes, OCI, giao diện S3. |
| Quy ước dữ liệu | ĐẠT | `smoke_pings.id` UUID v7 sinh ở ứng dụng; `timestamptz` UTC; không có tiền; bảng nhật ký kỹ thuật dùng chung, dọn theo tuổi 7 ngày (không xóa mềm vì không phải bảng nghiệp vụ của khách hàng). Không cache gì. |
| Cổng CI bắt buộc (5 mục) | ĐẠT | (1) truy cập chéo → `test:db`; (2) bảng có `account_id` chưa bật RLS → `db:check` trong `test:db`; (3) phụ thuộc module → `check:boundaries`; (4) kiểu + lint → `typecheck`, `lint`; (5) quét bí mật mã nguồn và nhật ký mẫu → `check:secrets`, `check:secrets:test-logs`. Tất cả chặn hợp nhất qua kiểm tra bắt buộc `ci/gates`. |
| Quy trình phát hành | ĐẠT có biện minh | Migration tương thích ngược kiểm hai lớp (`db:lint-migrations` + `db:compat` với bản đang chạy ở môi trường đích) và bất biến (`db:immutable`); `api` và `worker` phát hành cùng nhau, nguyên tử (`helm --atomic`); mọi thay đổi qua pull request đã đạt cổng; ruleset yêu cầu 1 người duyệt ở cả `dev` lẫn `master` **khi kho có từ hai thành viên**. Hiện kho có một thành viên nên chưa có người review thứ hai – vi phạm có chủ đích câu "mọi thay đổi MUST qua review", ghi ở Complexity Tracking. |

**Đánh giá lại sau Phase 1**: thiết kế chi tiết (data-model, 4 hợp đồng, quickstart) không tạo vi phạm mới. Ba điểm
đã soát kỹ:

1. *Ngoại lệ vượt cổng (FR-009) không được làm yếu nguyên tắc I, VII*: danh sách cấm ngoại lệ (R17) bao trọn các cổng
   thuộc nguyên tắc "không thương lượng" → ĐẠT.
2. *Điểm cuối `@Public` mới*: không trả dữ liệu khách hàng, không phân biệt được với 404 khi sai mã, thiếu
   `SMOKE_TOKEN` thì tắt hẳn → ĐẠT.
3. *Quyền tạo Job ở namespace migration* có thể bị lạm dụng để chạy ảnh tùy ý với Secret `owner` (R15 "rủi ro còn
   lại"): chặn bằng thông tin triển khai chỉ cấp cho nhánh đã bảo vệ + chính sách chấp nhận ảnh gửi 007 → chấp nhận
   được, theo dõi ở Rủi ro R-5.

## Project Structure

### Documentation (this feature)

```text
specs/008-cicd-jenkins-pipeline/
├── spec.md
├── plan.md                       # tệp này
├── research.md                   # R1–R23
├── data-model.md                 # GateResult, GateException, DeploymentRecord, EnvironmentParams, infra.smoke_pings
├── quickstart.md                 # phép thử theo US1–US4 và SC
├── contracts/
│   ├── quality-gates.md          # pnpm verify, danh sách cổng, Checks, luồng nhánh, ngoại lệ, test:compat
│   ├── deploy-pipeline.md        # các bước triển khai, chart, web, kiểm tra khói, redeploy, hotfix, thông báo
│   ├── jenkins-platform.md       # máy ảo, mạng, JCasC, phân quyền, thông tin xác thực, giữ dữ liệu
│   └── environment-inputs.md     # những gì 008 cần từ 007
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
docs/adr/ADR-11-jenkins-cicd.md   # ADR của FR-047 (viết ở bước kế hoạch)
```

### Source Code (repository root)

```text
tooling/
├── verify.mjs                          # + --ci, --only, --report, ngoại lệ; DEFAULT_STEPS thêm 5 bước
├── check-release-source.mjs            # mới – FR-005/005a/005b (R8)
├── check-image.mjs                     # mới – dựng ảnh, kiểm nội dung, chạy ba vai (R13)
├── check-pipeline.mjs                  # mới – phiên bản cố định, lược đồ, helm lint, ngoại lệ hợp lệ (R19)
├── db-compat.mjs                       # mới – bản đang chạy ở môi trường đích trên cấu trúc mới (R12)
├── scan-secrets.mjs                    # phạm vi quét thêm ops/**, infra/ci/**, Jenkinsfile*; nhận tệp nhật ký
└── test/*.spec.ts                      # kiểm thử cho các công cụ trên
package.json                            # + check:release-source, check:image, check:pipeline, db:immutable, db:compat, test:compat
Dockerfile                              # + ARG/ENV APP_VERSION, nhãn OCI

apps/server/
├── src/db/
│   ├── lint-migrations.ts              # + luật FR-017, MIGRATION_BASE_REF, gợi ý chia bước
│   └── check-immutable.ts              # mới – db:immutable (R11)
├── src/modules/queue/                  # điểm cuối ops/smoke + việc queue.smoke_ping (R18); xử lý loại việc lạ (R22)
│   └── internal/smoke/…                # controller, bộ gác mã, handler, schema infra.smoke_pings
├── drizzle/migrations/NNNN_infra_smoke_pings.sql
├── package.json                        # + test:compat (hợp đồng quality-gates.md mục 7)
└── test/
    ├── db/cross-tenant-coverage.db.spec.ts     # danh sách bảng từ catalog (R10)
    ├── db/access-path-inventory.db.spec.ts     # mới – khung nhìn, SECURITY DEFINER, bảng việc
    ├── db/fixtures/access-path-inventory.ts    # mới
    ├── db/ownership.db.spec.ts                 # + app không sở hữu bảng ở mọi schema
    ├── lint-migrations.spec.ts · check-immutable.spec.ts
    ├── ops/smoke.e2e.spec.ts                   # mới
    └── queue/smoke-ping.queue.spec.ts · unknown-job-type.queue.spec.ts   # mới

ops/
├── ci/
│   ├── Jenkinsfile.ci                  # chặng kiểm tra (nạp từ nhánh đã bảo vệ – R4)
│   ├── Jenkinsfile.deploy              # chặng triển khai, dùng chung hai môi trường
│   ├── Jenkinsfile.redeploy            # FR-034
│   ├── gate-lanes.json                 # gán cổng vào ba làn song song
│   ├── versions.env                    # phiên bản + mã băm Helm, kubectl, Trivy
│   ├── team.json                       # tên GitHub → tên Telegram, vai release-manager, nhóm trực
│   ├── exceptions/                     # GateException (*.yml) – chủ mã SA/PO
│   ├── toolchain/Dockerfile            # Node 24, pnpm, Chromium, git, docker CLI
│   ├── jenkins/                        # Dockerfile, plugins.txt, casc/*.yaml, jobs/*.groovy, compose.yaml
│   ├── vm/bootstrap.sh · vm/nftables.conf · vm/nginx.conf
│   ├── github/rulesets/{dev,master}.json · github/apply-rulesets.sh
│   └── scripts/notify-telegram.mjs · deployment-record.mjs · backmerge.mjs
├── deploy/
│   ├── chart/                          # Helm chart: api, worker, Service, Ingress, PDB, ConfigMap (không Secret)
│   ├── migrate-job.yaml                # Job migration ngoài chart
│   ├── env/staging.yaml · production.yaml · schema.json    # EnvironmentParams (provisioned: false ban đầu)
│   ├── scripts/publish-web.mjs
│   └── smoke/smoke.mjs
infra/ci/                               # Terraform máy ảo Jenkins (trạng thái riêng) + cloud-init
.github/CODEOWNERS                      # ops/ci/**, ops/deploy/**, infra/ci/** → SA, PO

docs/
├── adr/ADR-11-jenkins-cicd.md
└── ci-cd/                              # FR-046: branching-and-release.md, gates.md, backward-compatible-migrations.md,
                                        # rollback.md, gate-exceptions.md, rebuild-jenkins.md, credentials.md,
                                        # emergency-deploy.md
.specify/memory/architecture.md         # mục 11: bổ sung thuật ngữ (data-model.md mục 9)
README.md · CLAUDE.md                   # trỏ tới docs/ci-cd/, đổi nhánh phát hành thành master
```

**Structure Decision**: Giữ monorepo hiện có. Kiểm tra là mã trong `tooling/` và `apps/server` (chạy được trên máy cá
nhân); mọi thứ thuộc Jenkins ở `ops/ci/`; mọi thứ đưa ứng dụng lên cụm ở `ops/deploy/` (008 sở hữu, 007 dùng lại cho
triển khai tay – R23); hạ tầng máy Jenkins ở `infra/ci/` với trạng thái Terraform riêng. Phần mã ứng dụng duy nhất
nằm trong module `queue`.

## Thứ tự thực hiện gợi ý (đầu vào cho /speckit-tasks)

Theo thứ tự ưu tiên của đặc tả; mỗi giai đoạn kiểm chứng độc lập được bằng [quickstart.md](./quickstart.md).

1. **Nền (không cần Jenkins, không cần môi trường)** – `verify.mjs` (`--ci`, `--only`, `--report`), lược đồ
   `GateResult`, `Dockerfile` nhận `APP_VERSION`, `versions.env`, `check:pipeline`.
2. **US1a – các cổng mới chạy trên máy cá nhân**: luật mới của `db:lint-migrations`, `db:immutable`, bao phủ truy cập
   chéo theo catalog + kiểm kê đường vào, `check:image`, `db:compat` + `test:compat`, `check:release-source`, ngoại
   lệ. Kết thúc: bộ năm vi phạm cài sẵn bị `pnpm verify --ci` chặn 5/5 ngay trên máy cá nhân.
3. **US4 trước US1b – nền tảng Jenkins**: `infra/ci/`, `bootstrap.sh`, nftables, nginx, ảnh Jenkins, JCasC, hai tác
   nhân, thư mục + thông tin xác thực, GitHub App, OAuth, Audit Trail. (Làm trước vì chặng kiểm tra chạy mã chưa
   review – cô lập phải có từ lần chạy đầu.)
4. **US1b – chặng kiểm tra trên Jenkins**: `Jenkinsfile.ci` (nạp từ nhánh tin cậy), ba làn, Checks, rulesets +
   `CODEOWNERS`, tạo nhánh `master` từ `dev`, `ruleset-drift`.
5. **Mã ứng dụng cho triển khai**: `infra.smoke_pings`, `ops/smoke`, `queue.smoke_ping`, hành vi loại việc lạ (R22).
6. **US2 – triển khai test**: chart, Job migration, `publish-web.mjs`, `smoke.mjs`, `Jenkinsfile.deploy`,
   `DeploymentRecord`, Telegram, cửa `provisioned`. Chạy được tới "chưa có môi trường đích" khi 007 chưa xong; chạy
   thật khi `staging` sẵn sàng.
7. **US3 – release**: tham số `production`, Trivy chặn, `Jenkinsfile.redeploy`, luồng hotfix + backmerge, chạy lại
   `ci/gates` của pull request phát hành sau khi test xanh, các job `maintenance/*`.
8. **Tài liệu FR-046**, cập nhật `architecture.md` mục 11 / README / CLAUDE.md, diễn tập SC-013 và SC-014.

Phụ thuộc ngoài: bước 6–7 chạy thật cần môi trường của 007 đáp ứng `contracts/environment-inputs.md`.

## Rủi ro

| # | Rủi ro | Giảm thiểu / việc cần làm |
|---|---|---|
| R-1 | **Luật bảo vệ nhánh trên kho riêng tư cần gói GitHub trả phí (Team)** (R7). Không có thì FR-004 không thực thi được. | Chủ dự án xác nhận gói trước khi implement bước 4. Phương án thay nếu không mua: kho công khai (không phù hợp) – không có phương án kỹ thuật tương đương. |
| R-2 | **FR-004 đòi người duyệt khác tác giả**; GitHub không cho tác giả tự duyệt. Nếu thực tế chỉ có một người làm thì không hợp nhất được gì vào `dev` / `master`. | **Đã quyết (Clarifications 2026-11-13, sau `/speckit-analyze`)**: kho hiện có một thành viên → ruleset chạy chế độ một thành viên (0 người duyệt, chỉ `release-manager` hợp nhất vào `master`); `check:pipeline` buộc bật lại người duyệt khi `team.json` có từ hai thành viên. Ghi ở Complexity Tracking. |
| R-3 | Chi phí cố định mới: máy ảo 8 vCPU / 16 GB + đĩa + chụp đĩa, chạy 24/7. | Bắt đầu nhỏ hơn nếu đo SC-003 cho phép (kích thước là tham số Terraform); nhãn chi phí `component=ci`; ghi trong ADR-11 điều kiện xem xét lại. |
| R-4 | 007 chưa có kế hoạch → đầu vào môi trường có thể lệch (tên Secret, namespace, chính sách chấp nhận, CDN). | `environment-inputs.md` là yêu cầu gửi 007; `provisioned: false` cho phép 008 tiến trước; khớp lại khi 007 lập kế hoạch. |
| R-5 | Quyền tạo Job ở namespace migration + Secret `owner` (R15). | Thông tin chỉ cấp cho job trên nhánh đã bảo vệ, chủ mã duyệt `ops/deploy/**`; chính sách chỉ nhận ảnh từ kho ảnh của môi trường (007). |
| R-6 | Phần mở rộng nạp `Jenkinsfile` từ nhánh tin cậy (R4) chưa chốt giữa hai ứng viên. | Thử phép thử US4-1 với cả hai ở bước 3, cố định một cái trong `plugins.txt`; nếu cả hai không đạt thì dùng job Pipeline thường do Job DSL sinh cho từng pull request. |
| R-7 | Docker rootless: giới hạn về mạng/cgroup có thể làm chậm dựng ảnh hoặc Chromium. | Đo ở bước 3; điều kiện xem xét lại trong ADR-11 là tách hai máy ảo. |
| R-8 | SC-003 (≤ 15 phút) bị vượt khi bộ kiểm thử lớn dần, nhất là `db:compat` (cài và build bản gốc). | Ba làn song song, bộ nhớ đệm pnpm store và lớp ảnh theo tác nhân; `gate-lanes.json` điều chỉnh không cần sửa `Jenkinsfile`. |
| R-9 | Jenkins là điểm lỗi đơn: ngừng thì khóa hợp nhất. | Chấp nhận theo đặc tả; chụp đĩa hằng ngày, dựng lại từ mã ≤ 4 giờ, tài liệu triển khai khẩn cấp bằng tay. |
| R-10 | `test:compat` là hợp đồng mọi phiên bản sau phải giữ; kiểm thử cấu trúc lẫn vào sẽ gây đỏ giả. | Tập `test:compat` chọn theo quy ước tên/nhãn, `check:pipeline` kiểm kịch bản tồn tại; tài liệu `gates.md`. |
| R-11 | Bề mặt tấn công của Jenkins và phần mở rộng. | Giao diện không mở ra internet; chỉ `/github-webhook/` có kiểm chữ ký; phần mở rộng tối thiểu, cố định phiên bản, cập nhật qua pull request. |

### Trạng thái rủi ro khi kết thúc implement (cập nhật 2026-11-14)

| # | Trạng thái | Ghi chú |
|---|---|---|
| R-1 | **Mở** | Chủ dự án chưa dùng gói GitHub trả phí. Ruleset (`ops/ci/github/rulesets/`) và `apply-rulesets.sh` đã viết và được `check:pipeline` kiểm, nhưng **chưa áp** (T060); FR-004 tạm dựa vào kỷ luật của người duy nhất có quyền ghi. Phương án rẻ nhất khi cần: GitHub Team một ghế. |
| R-2 | **Đã xử lý trong thiết kế** | Chế độ một thành viên (0 người duyệt, `release-manager` bấm hợp nhất); `check:pipeline` buộc bật duyệt khi `team.json` có từ hai người. |
| R-3 | **Đổi hướng** | Thử nghiệm trên máy ảo VMware (`docs/ci-cd/vmware-lab.md`), không tốn tiền cloud; chi phí máy chạy thật chốt cùng 007. |
| R-4 | **Mở** | Chờ 007; `environment-inputs.md` + `provisioned: false` giữ phần còn lại chạy được. |
| R-5 | **Đã giảm thiểu bằng mã** | Thông tin theo thư mục, chủ mã duyệt `ops/deploy/**`; chưa kiểm trên Jenkins thật (T054). |
| R-6 | **Mở** | Chọn giữa `remote-file` và `pipeline-multibranch-defaults` cần Jenkins thật (T053). |
| R-7 | **Mở** | Chưa đo được trên máy thật (T052). |
| R-8 | **Mở** | `pnpm verify --ci` đầy đủ ~11 phút trên máy này (tuần tự); thời gian ba làn song song trên Jenkins chưa đo (T061). |
| R-9 | Chấp nhận | `emergency-deploy.md` đã viết, chưa diễn tập (T098). |
| R-10 | **Đã giảm thiểu** | `docs/ci-cd/gates.md` nêu hợp đồng; `test:compat` hiện 4 ca hành vi. |
| R-11 | **Đã giảm thiểu bằng mã** | nginx/nftables/plugins cố định ở `ops/ci/vm/`; chưa kiểm trên máy thật. |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Thêm một dịch vụ phải vận hành ở giai đoạn 1: **Jenkins** trên máy ảo riêng (nguyên tắc IX: "MUST NOT thêm … dịch vụ mới khi chưa có ADR") | Quyết định của chủ dự án trong mô tả tính năng ("tôi muốn Jenkins có mặt trong quy trình"); hiến pháp bắt buộc 5 kiểm tra chặn hợp nhất và WBS H2 là cổng sang đợt 1 nên phải có một công cụ điều phối. Được hợp thức hóa bằng **ADR-11** (FR-047). | *GitHub Actions với máy chạy do GitHub lưu trữ* (không phải vận hành gì, phương án SA chấm điểm cao nhất về công vận hành): thông tin triển khai release nằm ở dịch vụ nước ngoài, và trái yêu cầu trực tiếp của chủ dự án. *Chạy `pnpm verify` + triển khai tay*: không chặn được hợp nhất, trái hiến pháp. Chi tiết và điểm có trọng số ở ADR-11. |
| Hai dịch vụ nước ngoài mới trong **quy trình phát triển**: GitHub (mã nguồn, Checks, Deployments), Telegram (thông báo) | Clarifications 2026-11-13 (quyết định của chủ dự án). | Tự chạy Gitea/GitLab và kênh thông báo trong nước: thêm 1–2 dịch vụ phải vận hành cho đội nhỏ. Không có dữ liệu khách hàng đi ra; theo nguyên tắc VII hai bên nhận vẫn được ghi vào danh sách chuyển dữ liệu xuyên biên giới và trong ADR-11. |
| Chưa có người review thứ hai: khi kho chỉ có **một thành viên**, pull request vào `dev` / `master` hợp nhất được mà không cần người khác duyệt (hiến pháp: "mọi thay đổi MUST qua review; người review MUST xác nhận tuân thủ hiến pháp") | Quyết định của chủ dự án (Clarifications 2026-11-13): hiện chỉ một người làm và giữ quyền hợp nhất; GitHub không cho tác giả tự duyệt nên giữ yêu cầu người duyệt thì không hợp nhất được gì. Bù bằng: mọi thay đổi vẫn qua pull request, toàn bộ cổng chất lượng tự động (không cho ngoại lệ với các cổng thuộc nguyên tắc I, VII), `/constitution-review` trước khi kết thúc mỗi tính năng, và `check:pipeline` buộc bật lại người duyệt ngay khi có thành viên thứ hai. | *Tạo tài khoản thứ hai để tự duyệt*: hình thức, không phải review thật. *Giữ nguyên FR-004 cũ*: chặn toàn bộ quy trình. Cần SA/PO xác nhận ngoại lệ này; nếu muốn lâu dài thì sửa hiến pháp bằng `/speckit-constitution`. |
