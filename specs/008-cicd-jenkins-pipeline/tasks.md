---
description: "Danh sách việc – 008 Quy trình tích hợp và triển khai tự động (Jenkins) cho hai môi trường test và release"
---

# Tasks: Quy trình tích hợp và triển khai tự động (Jenkins) cho hai môi trường test và release

**Input**: tài liệu thiết kế trong `specs/008-cicd-jenkins-pipeline/` (plan.md, spec.md, research.md R1–R23,
data-model.md, contracts/, quickstart.md) và `docs/adr/ADR-11-jenkins-cicd.md`

**Tests**: CÓ – plan.md (mục Testing và cây mã nguồn) nêu đích danh các tệp kiểm thử cho công cụ mới và mã ứng dụng
mới; hiến pháp yêu cầu bộ xử lý việc nền có kiểm thử chạy lại hai lần. Phần Jenkins / môi trường thật kiểm chứng bằng
các phép thử của quickstart.md (không có kiểm thử tự động).

**Organization**: theo câu chuyện người dùng US1–US4 của spec.md. Thứ tự phase theo plan.md mục "Thứ tự thực hiện gợi
ý": US1 được chia hai phần (cổng trên máy cá nhân → chặng kiểm tra trên Jenkins) và **US4 (P4) được làm xen giữa**, vì
chặng kiểm tra chạy mã chưa review nên cô lập phải có từ lần chạy đầu tiên.

## Format: `[ID] [P?] [Story] Mô tả`

- **[P]**: chạy song song được (tệp khác nhau, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US4 theo spec.md
- Đường dẫn tính từ gốc worktree; mã định danh tiếng Anh, chú thích / thông điệp tiếng Việt (CLAUDE.md)
- **🖐 TAY**: việc cần người thật thao tác ngoài kho mã (tài khoản đám mây, GitHub, Telegram) – trợ lý chỉ chuẩn bị
  lệnh và tài liệu, không tự làm
- **⏳ 007**: chỉ chạy thật được khi môi trường của tính năng 007 đáp ứng `contracts/environment-inputs.md`
- Thuật ngữ Việt → Anh: data-model.md mục 9. Phiên bản công cụ **không** ghi trong tài liệu thiết kế: mỗi việc có cố
  định phiên bản phải tra bản phát hành hiện hành và mã băm chính thức lúc làm (R19)

---

## Phase 1: Setup

**Purpose**: khung thư mục, kịch bản gốc và các tệp dùng chung mà mọi phase sau tham chiếu

- [X] T001 Tạo khung thư mục (kèm `.gitkeep` ở thư mục còn trống): `ops/ci/{exceptions,jenkins/casc,jenkins/jobs,vm,github/rulesets,scripts,toolchain}`, `ops/deploy/{chart/templates,env,scripts,smoke}`, `infra/ci/`, `docs/ci-cd/`, `tooling/lib/`; viết `ops/ci/exceptions/README.md` (3–5 dòng: thư mục chứa `GateException`, trỏ tới `docs/ci-cd/gate-exceptions.md`)
- [X] T002 Thêm kịch bản vào `package.json` gốc: `"check:release-source": "node tooling/check-release-source.mjs"`, `"check:image": "node tooling/check-image.mjs"`, `"check:pipeline": "node tooling/check-pipeline.mjs"`, `"db:compat": "node tooling/db-compat.mjs"`, `"db:immutable": "pnpm --filter @app/server db:immutable"`, `"test:compat": "pnpm --filter @app/server test:compat"`; thêm vào `apps/server/package.json`: `"db:immutable"` (chạy `src/db/check-immutable.ts` theo cùng cách `db:lint-migrations` đang chạy) và `"test:compat"` (trỏ tới kịch bản của T027). Chưa thêm bước nào vào `DEFAULT_STEPS` ở việc này
- [X] T003 [P] Tạo `ops/ci/versions.env`: nơi **duy nhất** ghi phiên bản + mã băm SHA-256 của `HELM`, `KUBECTL`, `TRIVY` (dạng `HELM_VERSION=…`, `HELM_SHA256_LINUX_AMD64=…`) và ảnh PostgreSQL kiểm thử theo digest (`TEST_POSTGRES_IMAGE=postgres:<chính>@sha256:…`, cùng phiên bản chính với `docker-compose.yml` hiện có); đầu tệp có chú thích cách cập nhật qua pull request (R19)
- [X] T004 [P] Tạo `ops/ci/team.json`: `{ "members": [{ "github": "…", "telegram": "…", "roles": ["developer" | "release-manager"] }], "onCall": ["<tên Telegram>"] }`; điền thành viên hiện có của kho, còn lại để mảng rỗng (không bịa tên); vai `release-manager` = SA, PO (data-model.md mục 2)
- [X] T005 [P] Tạo `.github/CODEOWNERS`: `ops/ci/**`, `ops/deploy/**`, `infra/ci/**`, `.github/CODEOWNERS` → các tài khoản `release-manager` trong `ops/ci/team.json` (R7, R17)
- [X] T006 [P] Cập nhật `.gitignore` (`verify-report*.json`, thư mục tạm của `db:compat` `.compat-base/`, `infra/ci/.terraform/`, `*.tfstate*`) và `.prettierignore` (`ops/deploy/chart/templates/` – mẫu Helm không phải YAML hợp lệ); xác nhận `pnpm lint` vẫn đạt

---

## Phase 2: Foundational (chặn mọi câu chuyện)

**Purpose**: `pnpm verify` thành nguồn sự thật duy nhất của cổng (R9), ảnh mang mã phiên bản (R13), tham số môi trường
(R20), cổng kiểm chính định nghĩa quy trình (R19)

**⚠️ CRITICAL**: chưa xong phase này thì chưa làm US nào

- [X] T007 Mở rộng `tooling/verify.mjs` theo contracts/quality-gates.md mục 1: `--only <bước>[,<bước>]` (tên lạ → lỗi nêu danh sách hợp lệ); `--ci` hoặc `CI=true` → bước bị bỏ qua (`requiresEnv` thiếu hoặc lệnh in `SKIPPED:`) **tính là không đạt** (FR-008); trạng thái mới `not_applicable` khi lệnh thoát mã 0 và in dòng bắt đầu bằng `NOT_APPLICABLE: <lý do>`; mỗi kết quả có `rerun` = `pnpm verify --only <tên>`; bảng tổng kết giữ dạng hiện có, thêm `· không áp dụng`, và in lệnh chạy lại dưới mỗi bước không đạt (FR-010); giữ nguyên `--steps`
- [X] T008 Thêm `--report <tệp.json>` vào `tooling/verify.mjs`, ghi đúng lược đồ `GateResult` ở data-model.md mục 1 (`schema: 1`, `commit` = `git rev-parse HEAD`, `mode` = `"local"`|`"ci"`, `results[]` với `name`, `status` ∈ `"passed" | "failed" | "skipped" | "excepted" | "not_applicable"`, `seconds`, `firstError`, `rerun`, `note`, `exception`, và `passed`); quy tắc `passed` = mọi kết quả thuộc `passed` | `excepted` | `not_applicable`, chế độ `ci` thì `skipped` là không đạt; mã thoát `0` khi `passed`, `1` khi không
- [X] T009 [P] Mở rộng `tooling/test/verify.spec.ts` (dùng `--steps` với bước giả): `--only` lọc đúng và báo lỗi tên lạ; `--ci` biến bỏ qua thành không đạt còn chế độ thường thì không; `NOT_APPLICABLE:` → `not_applicable` kèm `note`; tệp `--report` đúng lược đồ và `passed` đúng quy tắc; mã thoát
- [X] T010 [P] Sửa `Dockerfile`: `ARG APP_VERSION=dev` → `ENV APP_VERSION=$APP_VERSION` ở tầng chạy; nhãn OCI `org.opencontainers.image.revision`, `.created`, `.source` (qua `ARG`); không đổi người dùng chạy (`node`) và digest ảnh nền (R13, data-model.md mục 3)
- [X] T011 [P] Mở rộng `tooling/scan-secrets.mjs`: phạm vi mặc định thêm `ops/**`, `infra/ci/**`, `Jenkinsfile*`, `.github/**`; tham số vị trí nhận **tệp đơn lẫn thư mục** (để quét nhật ký chạy – contracts/deploy-pipeline.md mục 9); báo tệp + dòng, **không in giá trị**; thêm ca kiểm thử vào `tooling/test/scan-secrets.spec.ts`
- [X] T012 [P] Tạo `ops/deploy/env/schema.json` (JSON Schema của `EnvironmentParams`, đủ các trường ở data-model.md mục 5: `name` ∈ `staging`|`production`, `branch` ∈ `dev`|`master`, `provisioned` boolean, `registry.repository`, `cluster.server`, `cluster.namespaces.app`, `cluster.namespaces.migrate`, `api.baseUrl`, `web.baseUrl`, `web.bucket`, `web.s3Endpoint`, `web.s3Region`, `web.buildEnv`, `replicas.api`, `replicas.worker`, `secrets.app`, `secrets.dbOwner`, `vulnerabilityPolicy` ∈ `block`|`warn`, `rollout.timeoutSeconds`, `smoke.timeoutSeconds`; cấm trường lạ) và hai tệp `ops/deploy/env/staging.yaml` (`branch: dev`, `vulnerabilityPolicy: warn`), `ops/deploy/env/production.yaml` (`branch: master`, `vulnerabilityPolicy: block`), cả hai `provisioned: false`, `rollout.timeoutSeconds: 480`, `smoke.timeoutSeconds: 180`; trường chưa biết từ 007 để chuỗi rỗng kèm chú thích `# chờ 007` (lược đồ chỉ bắt buộc khác rỗng khi `provisioned: true`)
- [X] T013 [P] Tạo `ops/ci/gate-lanes.json`: gán các bước **hiện có** của `DEFAULT_STEPS` vào ba làn (`static`: build:shared, typecheck, lint, check:boundaries, check:secrets, test, check:web-bundle, db:lint-migrations · `db`: test:db, test:queue, check:secrets:test-logs · `e2e`: test:e2e); có trường `order` để `check:secrets:test-logs` chạy sau các bước kiểm thử của làn
- [X] T014 Viết `tooling/check-pipeline.mjs` (R19) và thêm bước `check:pipeline` vào `DEFAULT_STEPS` của `tooling/verify.mjs` + làn `static` của `ops/ci/gate-lanes.json`. Kiểm: (1) mọi `FROM` trong `Dockerfile`, `ops/ci/**/Dockerfile` và mọi `image:` trong `ops/**/*.y?(a)ml` có `@sha256:`; (2) `ops/ci/jenkins/plugins.txt` (nếu có) mỗi dòng `<tên>:<phiên bản>`, không `latest`; (3) `ops/ci/versions.env` có đủ phiên bản + mã băm; (4) hai tệp `ops/deploy/env/*.yaml` đúng `schema.json`, `name` khớp tên tệp; (5) mọi bước của `DEFAULT_STEPS` thuộc đúng một làn trong `gate-lanes.json` và không làn nào nêu bước không tồn tại; (6) `ops/ci/github/rulesets/*.json` (nếu có) là JSON hợp lệ và có kiểm tra bắt buộc `ci/gates`; (7) `helm lint` + `helm template` chart với cả hai bộ tham số **khi có chart và có `helm`** – thiếu `helm`: máy cá nhân bỏ qua riêng mục này có thông báo, `--ci`/`CI=true` thì không đạt; (8) `test:compat` tồn tại trong `apps/server/package.json`. Thông điệp tiếng Việt, nêu tệp + dòng
- [X] T015 [P] Viết `tooling/test/check-pipeline.spec.ts` với thư mục mẫu trong `tooling/test/fixtures/pipeline/`: ảnh thiếu digest, `plugins.txt` có `latest`, tệp tham số sai lược đồ, bước không thuộc làn nào → mỗi ca không đạt và nêu đúng tệp; bộ hợp lệ → đạt

**Checkpoint**: `pnpm verify`, `pnpm verify --ci --report verify-report.json`, `pnpm verify --only lint` chạy đúng hợp
đồng; phép thử FR-008 ở quickstart A1 đạt

---

## Phase 3: User Story 1 (phần A) – Các cổng mới chạy được trên máy cá nhân (Priority: P1) 🎯 MVP

**Goal**: mọi cổng của FR-006 và các cổng mới (`db:immutable`, `db:compat`, `check:image`, `check:release-source`,
ngoại lệ) tồn tại dưới dạng lệnh chạy được ở máy cá nhân, cho kết quả giống hệt khi Jenkins gọi (FR-007, SC-012)

**Independent Test**: quickstart A1–A4 – bộ năm vi phạm cài sẵn bị `pnpm verify --ci` chặn 5/5, mỗi cái nêu đúng nguyên
nhân và lệnh chạy lại; nhánh sạch đạt (SC-002) – không cần Jenkins, không cần môi trường

### Tương thích ngược tĩnh và migration bất biến (FR-017, FR-019, FR-020 · R11)

- [X] T016 [P] [US1] Sửa `apps/server/src/db/lint-migrations.ts`: nhánh gốc lấy từ `MIGRATION_BASE_REF`, mặc định đổi từ `main` sang `origin/dev`; thêm luật (mỗi luật có mã, lý do và **cách chia bước thay thế** in kèm): `ADD COLUMN … NOT NULL` không có `DEFAULT`; `ADD CONSTRAINT` (CHECK/FK/UNIQUE) trên bảng đã có mà không `NOT VALID` / không qua chỉ mục dựng sẵn; `CREATE INDEX` không `CONCURRENTLY` trên bảng đã có; `DROP TYPE` / bỏ giá trị enum; giữ cơ chế `-- breaking-ok: <lý do>` ngay trên câu lệnh (data-model.md mục 7); mỗi vi phạm in tệp, câu lệnh, lý do, cách thay thế
- [X] T017 [P] [US1] Mở rộng `apps/server/test/lint-migrations.spec.ts`: một ca vi phạm + một ca hợp lệ cho từng luật mới của T016; ca `MIGRATION_BASE_REF`; ca `-- breaking-ok:` cho qua luật tĩnh
- [X] T018 [P] [US1] Viết `apps/server/src/db/check-immutable.ts` (`db:immutable`): so `apps/server/drizzle/migrations/**` và `meta/_journal.json` giữa `MIGRATION_BASE_REF` (mặc định `origin/dev`) và HEAD bằng `git`; tệp đã có ở nhánh gốc bị sửa / xóa / đổi tên → không đạt, nêu tệp; `_journal.json` chỉ được **nối thêm vào cuối**; không có nhánh gốc (kho mới) → `NOT_APPLICABLE:` kèm lý do
- [X] T019 [P] [US1] Viết `apps/server/test/check-immutable.spec.ts` trên kho git tạm: sửa nội dung tệp cũ, xóa tệp cũ, chèn mục vào giữa `_journal.json` → không đạt; chỉ thêm tệp mới + nối nhật ký → đạt
- [X] T020 [US1] Thêm bước `db:immutable` vào `DEFAULT_STEPS` của `tooling/verify.mjs` (ngay sau `db:lint-migrations`) và vào làn `static` của `ops/ci/gate-lanes.json`
- [X] T021 [US1] Kiểm chứng thứ tự áp migration (spec Edge "Bản sửa nóng có kèm migration"): viết `apps/server/test/db/migration-order.db.spec.ts` dùng đúng `runMigrations` của `apps/server/src/db/migrate.ts` trên thư mục migration tạm – áp A, B; thêm C có mốc `when` trong `_journal.json` nằm **giữa** A và B; chạy lại – và khẳng định điều quan sát được (C được áp / bị bỏ qua âm thầm / báo lỗi). Ghi kết quả vào `specs/008-cicd-jenkins-pipeline/research.md` mục R11. Nếu C **bị bỏ qua âm thầm**: sửa edge case đó trong `specs/008-cicd-jenkins-pipeline/spec.md` thành "sửa nóng không kèm migration; cần đổi cấu trúc thì đi đường phát hành thường" và áp luật chặn ở T030; nếu C được áp hoặc báo lỗi rõ: giữ đặc tả, ghi cách đánh số migration khi backmerge để đưa vào tài liệu ở T092

### Truy cập chéo tenant: bao phủ theo catalog và kiểm kê đường vào (FR-013…016, SC-008 · R10)

- [X] T022 [P] [US1] Sửa `apps/server/test/db/cross-tenant-coverage.db.spec.ts`: sau khi migrate CSDL tạm, lấy danh sách bảng từ `pg_attribute`/`pg_class` – mọi bảng có cột `account_id` trong các schema khai báo ở `apps/server/src/modules/modules.manifest.json` – thay cho `tableRegistry`; bảng không có fixture trong `test/db/fixtures/cross-tenant-fixtures.ts` và không có mục miễn trừ kèm lý do → không đạt, **nêu tên bảng**; in `đã phủ N / tổng M bảng` ở mỗi lần chạy (SC-008)
- [X] T023 [P] [US1] Tạo `apps/server/test/db/fixtures/access-path-inventory.ts` và `apps/server/test/db/access-path-inventory.db.spec.ts`: từ catalog lấy (a) mọi khung nhìn mà `support` hoặc `app` được `SELECT`, (b) mọi hàm `SECURITY DEFINER` mà `app` được `EXECUTE`, (c) `pgboss.job_common`; mỗi mục phải có trong tệp kiểm kê với một ca chứng minh vai trò `app` trong ngữ cảnh tài khoản A không lấy được dữ liệu của B, hoặc một lý do miễn trừ; mục có trong catalog mà chưa kiểm kê → không đạt, nêu tên (FR-015)
- [X] T024 [P] [US1] Mở rộng `apps/server/test/db/ownership.db.spec.ts`: vai trò `app` không sở hữu bảng nào trong **mọi** schema không phải hệ thống (không chỉ schema của module) và không có `BYPASSRLS` (FR-016)

### Ảnh phát hành chạy ba vai (FR-022…024 · R13)

- [X] T025 [US1] Viết `tooling/check-image.mjs`: `docker build --build-arg APP_VERSION=<HEAD sha>`; khẳng định trong ảnh không có `.env*`, không có mã / bản dựng web, không có `devDependencies` (kiểm vài gói đại diện như `vitest`, `typescript`), `USER` không phải root; tạo CSDL tạm bằng `TEST_DATABASE_ADMIN_URL` rồi chạy ảnh ở ba vai theo thứ tự `migrate` (`node dist/db/migrate.js`) → `api` → `worker`, chờ `/healthz`, `/readyz` của `api` và cổng sức khỏe 3001 của `worker` trả `version` = SHA; luôn dọn container và CSDL tạm; thiếu Docker hoặc CSDL → `SKIPPED:` (máy cá nhân) – `--ci` biến thành không đạt nhờ T007. Thêm bước `check:image` vào `DEFAULT_STEPS` (`requiresEnv: TEST_DATABASE_ADMIN_URL`) và tạo làn `image` trong `ops/ci/gate-lanes.json`
- [X] T026 [P] [US1] Viết `tooling/test/check-image.spec.ts` cho phần thuần logic của T025 (phân tích kết quả kiểm nội dung ảnh, so `version`, dọn dẹp khi lỗi) bằng trình chạy lệnh giả – không dựng ảnh thật trong kiểm thử đơn vị

### Tương thích ngược động (FR-018, FR-020 · R12, hợp đồng quality-gates.md mục 7)

- [X] T027 [US1] Tạo `test:compat` cho `apps/server`: `apps/server/vitest.compat.config.mts` + `apps/server/scripts/test-compat.mjs` + tập kiểm thử `apps/server/test/compat/*.compat.spec.ts`. Hợp đồng (mọi phiên bản từ 008 phải giữ): nhận `COMPAT_DATABASE_OWNER_URL` / `_APP_URL` / `_SYSTEM_URL` / `_SUPPORT_URL` trỏ CSDL **đã migrate sẵn**; MUST NOT tự chạy migration, MUST NOT xóa/tạo lại schema; khởi động `api` và `worker` của chính nó, chờ `/healthz` + `/readyz`; chạy tập kiểm thử hành vi trên CSDL (đọc/ghi qua `tenantTx`/`systemTx` của các module hiện có) và một vòng tạo việc → xử lý việc; MUST NOT chứa kiểm thử khẳng định cấu trúc (số migration, quy ước bảng, danh sách schema); mã thoát `0` = chạy được trên cấu trúc mới
- [X] T028 [US1] Viết `tooling/db-compat.mjs` (`db:compat`): (1) bản gốc = `COMPAT_BASE_SHA`, mặc định `origin/<GATE_TARGET_BRANCH hoặc dev>`; biến đặt giá trị `none` → `NOT_APPLICABLE: chưa có bản đang chạy`; (2) không có tệp migration mới so với bản gốc → `NOT_APPLICABLE: không có migration mới`; (3) bản gốc không có kịch bản `test:compat` → `NOT_APPLICABLE:` kèm lý do (chỉ xảy ra với bản trước 008); (4) `git worktree add` bản gốc vào `.compat-base/`, `pnpm install --frozen-lockfile`, build; (5) tạo CSDL tạm, áp **toàn bộ migration của HEAD** bằng vai trò `owner`; (6) trong thư mục bản gốc chạy `pnpm test:compat` với các `COMPAT_DATABASE_*_URL`; (7) luôn gỡ worktree và CSDL tạm. Không đạt thì nêu bản gốc, migration mới và dòng lỗi đầu của bản gốc. Thêm bước `db:compat` vào `DEFAULT_STEPS` (`requiresEnv: TEST_DATABASE_ADMIN_URL`) và làn `db`
- [X] T029 [P] [US1] Viết `tooling/test/db-compat.spec.ts`: ba nhánh `NOT_APPLICABLE` của T028 và việc dọn worktree khi lỗi (trình chạy lệnh giả)

### Cổng nguồn phát hành (FR-005, FR-005a, FR-005b · R8)

- [X] T030 [US1] Viết `tooling/check-release-source.mjs` đúng bảng ở contracts/quality-gates.md mục 4, đọc `GATE_TARGET_BRANCH`, `GATE_SOURCE_BRANCH`, `STAGING_DEPLOYED_SHA`: đích ≠ `master` → `NOT_APPLICABLE: đích không phải master`; nguồn `dev` → `git merge-base --is-ancestor HEAD <STAGING_DEPLOYED_SHA>` (không đạt: "Commit `<sha>` chưa được triển khai thành công lên test. Chờ test xanh rồi chạy lại.") **và** `git rev-list --count --no-merges origin/master ^HEAD` = 0 (không đạt: "Bản sửa nóng `<sha>` chưa về dev – hợp nhất pull request backmerge trước."); nguồn `hotfix/*` → không commit nào trong `origin/master..HEAD` là tổ tiên của `origin/dev` (không đạt: "Nhánh hotfix mang commit của dev: `<sha>`. Tách lại từ master."); nguồn khác → "master chỉ nhận từ dev hoặc hotfix/*."; thiếu `STAGING_DEPLOYED_SHA` khi cần → không đạt có thông điệp rõ; theo kết quả T021: nếu migration có mốc cũ hơn bị bỏ qua âm thầm → nguồn `hotfix/*` có tệp mới trong `apps/server/drizzle/migrations/` so với `origin/master` là không đạt ("Sửa nóng không được kèm migration – đi đường phát hành thường."). Thêm bước vào `DEFAULT_STEPS` và làn `static`
- [X] T031 [P] [US1] Viết `tooling/test/check-release-source.spec.ts` trên kho git tạm dựng đủ năm dòng của bảng mục 4 (thêm ca hotfix kèm migration nếu luật của T021 được bật; gồm cả ca sửa nóng chưa về `dev` sau một merge commit phát hành thường)

### Ngoại lệ vượt cổng (FR-009 · R17)

- [X] T032 [US1] Viết `tooling/lib/gate-exceptions.mjs` (đọc + kiểm `ops/ci/exceptions/*.yml` theo data-model.md mục 2: `gate` là tên một bước và **không** thuộc danh sách cấm `test:db`, `check:secrets`, `check:secrets:test-logs`, `db:immutable`, `check:release-source`; `reason` chuỗi ≥ 20 ký tự; `approvedBy` là tên GitHub có vai `release-manager` trong `ops/ci/team.json`; `expiresAt` ISO-8601 UTC và ≤ 7 ngày kể từ ngày trong tên tệp `<YYYY-MM-DD>-<slug>.yml`; có `pullRequest` hoặc `commit`, thiếu cả hai → không hợp lệ) và nối vào `tooling/verify.mjs`: ở `--ci`, cổng không đạt có ngoại lệ **còn hạn** và hợp lệ → `excepted` (bảng tổng kết hiện `! ngoại lệ`, `GateResult.exception = { file, approvedBy }`); hết hạn → bị bỏ qua
- [X] T033 [US1] Bổ sung `tooling/check-pipeline.mjs`: mọi tệp trong `ops/ci/exceptions/` phải hợp lệ theo T032 (không hợp lệ → không đạt, nêu trường sai); ngoại lệ hết hạn → cảnh báo nhắc xóa (không làm đỏ)
- [X] T034 [P] [US1] Viết `tooling/test/gate-exceptions.spec.ts`: ngoại lệ hợp lệ biến `lint` đỏ thành `excepted`; `gate: test:db` → không hợp lệ; `expiresAt` quá khứ → bị bỏ qua; `expiresAt` > 7 ngày, `reason` < 20 ký tự, `approvedBy` không phải `release-manager`, thiếu phạm vi → không hợp lệ

### Kiểm chứng US1 phần A

- [X] T035 [US1] Chạy quickstart A1 (hai chế độ + phép thử FR-008) và A3 (ba cổng mới, phép thử `db:compat` bắt được `-- breaking-ok:` mà mã ở `origin/dev` còn đọc, hai phép thử `check:release-source`); sửa lệch nếu có trong `tooling/verify.mjs` và các công cụ T016–T030
- [X] T036 [US1] Chạy quickstart A2 (năm nhánh nháp a–e, mỗi nhánh một vi phạm) + nhánh sạch đối chứng và A4 (ngoại lệ): mỗi cổng KHÔNG ĐẠT đúng nguyên nhân, in đủ tên cổng · dòng lỗi đầu · lệnh chạy lại; giữ năm nhánh nháp ở máy (không đẩy) để dùng lại ở T062; ghi kết quả 5/5 vào mục "Kết quả kiểm chứng" cuối `specs/008-cicd-jenkins-pipeline/quickstart.md`

**Checkpoint**: MVP – toàn bộ cổng chất lượng chạy được và chặn đúng trên máy cá nhân; chưa cần Jenkins hay môi trường

---

## Phase 4: User Story 4 – Nền tảng Jenkins, thông tin triển khai giữ kín và tách theo môi trường (Priority: P4, làm trước phần B của US1)

**Goal**: một máy Jenkins dựng hoàn toàn từ mã, hai tác nhân tách quyền, thông tin xác thực theo thư mục, giao diện
không mở ra internet (FR-038…042, R1–R6)

**Independent Test**: quickstart B6, B7, B8 (và B4, B5, B11 sau khi có job `ci/gates` ở Phase 5): thông tin của môi
trường này không dùng được cho môi trường kia; người ngoài nhóm bị từ chối và được ghi lại; webhook không chữ ký bị từ
chối

### Quyết định trước khi dựng (hiến pháp IX, VII · rủi ro R-1…R-3)

- [ ] T037 [US4] 🖐 TAY – Chốt `docs/adr/ADR-11-jenkins-cicd.md` **trước khi dựng bất cứ thứ gì** (hiến pháp nguyên tắc IX: không thêm dịch vụ khi chưa có ADR; "quyết định của khách hàng khác đề xuất của SA MUST ghi lý do"): chủ dự án bổ sung lý do chọn Jenkins ở mục 5, SA duyệt, đổi trạng thái "Đề xuất" → "Chấp nhận" kèm ngày; thêm dòng tham chiếu ADR-11 vào bảng ADR của `TaiLieuDacTa/ADR_App_AI_Content_MXH.md`; thêm hai dòng vào danh sách chuyển dữ liệu xuyên biên giới ở `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md` mục 9 (nguyên tắc VII): **GitHub** – mã nguồn, kết quả kiểm tra, bản ghi triển khai có tên người hợp nhất / duyệt; **Telegram** – siêu dữ liệu triển khai có tên tác giả; cả hai ghi chú "quy trình phát triển, không có dữ liệu khách hàng". Chặn T052: không dựng máy ảo khi ADR-11 còn ở trạng thái "Đề xuất"
- [ ] T038 [US4] 🖐 TAY – **Điểm quyết định trước khi tốn chi phí** (rủi ro R-1, R-2, R-3 của plan.md): chủ dự án xác nhận (1) kho dùng gói GitHub cho phép ruleset trên kho riêng tư; (2) nhà cung cấp đám mây trong nước, kích thước và ngân sách máy ảo (có thể bắt đầu nhỏ hơn 8 vCPU / 16 GB – `vm_flavor` là tham số); (3) số thành viên thật trong `ops/ci/team.json`: **một người** → ruleset dùng chế độ một thành viên của FR-004 (không yêu cầu người duyệt, chỉ `release-manager` hợp nhất vào `master`); **từ hai người** → bật yêu cầu người duyệt khác tác giả. Ghi quyết định vào `specs/008-cicd-jenkins-pipeline/plan.md` mục Rủi ro. Chặn T052 và T058

### Hạ tầng máy ảo (contracts/jenkins-platform.md mục 1–3)

- [ ] T039 [P] [US4] Viết Terraform `infra/ci/` (`versions.tf` cố định phiên bản provider, `main.tf`, `variables.tf`, `outputs.tf`, `modules/vm/`): một máy ảo Ubuntu LTS trên đám mây trong nước (cùng nhà cung cấp dự kiến của 007 – ưu tiên VNG Cloud theo hiến pháp; phần phụ thuộc nhà cung cấp gói trong `modules/vm/` – R23), mạng con riêng **không peering** với mạng hai môi trường, đĩa dữ liệu riêng cho `JENKINS_HOME`, chụp đĩa hằng ngày giữ 14 bản, nhãn chi phí `component=ci`; biến `vm_flavor` (mặc định tương đương 8 vCPU · 16 GB), `data_disk_gb` (mặc định 200), `admin_cidrs`; nhóm bảo mật vào: `443` từ mọi nơi (nginx lọc đường dẫn), `22` chỉ từ `admin_cidrs`; đầu ra `public_ip` (gửi 007 đưa vào danh sách được phép); trạng thái Terraform riêng, không dùng chung với 007; `cloud-init` chạy `ops/ci/vm/bootstrap.sh`
- [X] T040 [P] [US4] Viết `ops/ci/vm/bootstrap.sh` (chạy lại được nhiều lần): tạo ba người dùng `jenkins`, `ci-agent`, `deploy-agent` không chung nhóm, thư mục nhà `0700`, `ci-agent` không `sudo` và không thuộc nhóm `docker`; cài Docker rootless riêng cho `ci-agent` và `deploy-agent`; gắn đĩa dữ liệu vào `JENKINS_HOME`; cài `helm`, `kubectl`, `trivy` **chỉ cho `deploy-agent`** theo `ops/ci/versions.env` có kiểm SHA-256; áp `nftables.conf`, `nginx.conf`; tạo `/etc/jenkins-secrets/` (`0400`, chủ `jenkins`) – **không** ghi giá trị bí mật; cài các đơn vị systemd của T042; khởi động bộ điều khiển bằng `ops/ci/jenkins/compose.yaml`
- [X] T041 [P] [US4] Viết `ops/ci/vm/nftables.conf` lọc đường ra theo `skuid` đúng bảng "Ra" ở contracts/jenkins-platform.md mục 3: `ci-agent` chỉ tới GitHub, kho gói npm, kho ảnh công khai; **chặn** `ci-agent` tới kho ảnh riêng tư, điểm quản trị cụm, S3 tĩnh, Telegram; `deploy-agent` tới các đích triển khai; không người dùng nào tới CSDL / kho tệp media / KMS; địa chỉ đích là biến (tệp `/etc/nftables.d/ci-targets.nft` do bootstrap sinh từ `ops/deploy/env/*.yaml`); và `ops/ci/vm/nginx.conf`: TLS, `/github-webhook/` mở cho internet, mọi đường dẫn khác chỉ nhận từ `admin_cidrs`, còn lại trả 403
- [X] T042 [P] [US4] Viết đơn vị systemd `ops/ci/vm/systemd/jenkins-agent-ci.service` (người dùng `ci-agent`) và `jenkins-agent-deploy.service` (người dùng `deploy-agent`): tác nhân kết nối vào bộ điều khiển, khởi động lại khi lỗi, `NoNewPrivileges=yes`, `ProtectHome=tmpfs`/đường dẫn riêng để không đọc được thư mục của hai người dùng kia

### Jenkins cấu hình bằng mã (contracts/jenkins-platform.md mục 4–7 · R2, R3, R6)

- [X] T043 [P] [US4] Viết `ops/ci/jenkins/Dockerfile` (`FROM jenkins/jenkins:<LTS>@sha256:…` + `jenkins-plugin-cli -f plugins.txt`) và `ops/ci/jenkins/plugins.txt` cố định từng phiên bản: Configuration as Code, Job DSL, Pipeline, GitHub Branch Source, Checks API, GitHub Checks, Credentials Binding, Matrix Authorization, GitHub Authentication, Lockable Resources, Timestamper, Audit Trail, Pipeline Utility Steps (đọc tệp báo cáo JSON); phần mở rộng nạp `Jenkinsfile` từ nhánh tin cậy thêm ở T053
- [X] T044 [P] [US4] Viết `ops/ci/jenkins/compose.yaml`: bộ điều khiển chạy dưới người dùng `jenkins`, ảnh theo digest, `JENKINS_HOME` trên đĩa dữ liệu, `CASC_JENKINS_CONFIG` trỏ `casc/`, gắn `/etc/jenkins-secrets/` chỉ đọc, chỉ nghe `127.0.0.1` (nginx đứng trước)
- [X] T045 [US4] Viết `ops/ci/jenkins/casc/security.yaml`: `numExecutors: 0`; đăng nhập GitHub OAuth; ma trận quyền đúng bảng contracts/jenkins-platform.md mục 5 cho `developers`, `release-managers`, ẩn danh (ẩn danh không có quyền gì; `developers` không chạy tay / chạy lại được `deploy/production/*`; không ai sửa cấu hình job qua giao diện; quản trị chỉ SA); bật CSRF; tắt CLI qua remoting; Audit Trail ghi thao tác quản trị và lần bị từ chối vào tệp riêng trên đĩa dữ liệu, xoay vòng giữ 12 tháng
- [X] T046 [US4] Viết `ops/ci/jenkins/casc/credentials.yaml` theo data-model.md mục 6 – khai báo **theo thư mục**, giá trị tham chiếu `${readFile:/etc/jenkins-secrets/…}`: `github-app-ci` ở `ci/`; `github-app-deploy`, `telegram-bot` ở `deploy/`; `registry`, `kubeconfig`, `static-site`, `smoke` ở `deploy/staging/` và **cùng mã định danh, khác giá trị** ở `deploy/production/` (R3); không có thông tin xác thực phạm vi toàn cục; không khai báo mật khẩu vai trò CSDL, khóa kho tệp media hay KMS
- [X] T047 [P] [US4] Viết `ops/ci/jenkins/casc/nodes.yaml` (hai tác nhân cố định nhãn `ci` / `deploy`, mỗi tác nhân chỉ nhận job gắn đúng nhãn) và `ops/ci/jenkins/casc/jobs.yaml` (gọi Job DSL nạp `ops/ci/jenkins/jobs/*.groovy`)
- [X] T048 [US4] Viết `ops/ci/jenkins/jobs/folders.groovy`: thư mục `ci/`, `deploy/`, `deploy/staging/`, `deploy/production/`, `maintenance/` kèm quyền theo thư mục; thời gian giữ lần chạy theo contracts/jenkins-platform.md mục 7 (`deploy/*` 400 ngày; `ci/gates` 90 ngày hoặc 200 lần gần nhất mỗi pull request)
- [X] T049 [P] [US4] Viết `ops/ci/toolchain/Dockerfile` (ảnh công cụ cho mọi làn kiểm tra, ảnh nền theo digest): Node 24, pnpm đúng `packageManager` của `package.json`, Chromium của Playwright đúng phiên bản `e2e/package.json`, git, docker CLI; chạy không phải root
- [X] T050 [P] [US4] Viết `ops/ci/jenkins/jobs/maintenance_credential_age.groovy` + `ops/ci/scripts/credential-age.mjs`: hằng ngày đọc ngày xoay của từng thông tin (tệp `/etc/jenkins-secrets/rotation.json`, không chứa giá trị) và báo Telegram khi quá 90 ngày

### Dựng thật và kiểm chứng

- [X] T051 [US4] Viết bản đầu của `docs/ci-cd/rebuild-jenkins.md` và `docs/ci-cd/credentials.md` (đủ để làm T052): thứ tự `terraform apply` → chờ `cloud-init` → nhập bí mật; cách tạo hai GitHub App "ci" (đọc nội dung, đọc pull request, ghi Checks, đọc Deployments) và "deploy" (ghi nội dung, ghi pull request, ghi Deployments), ứng dụng GitHub OAuth, bí mật webhook, bot + nhóm Telegram; tên tệp và quyền của từng tệp trong `/etc/jenkins-secrets/`; cách xoay từng thông tin và cập nhật `rotation.json`
- [ ] T052 [US4] 🖐 TAY – Chủ dự án / SA dựng thật theo T051 (chỉ sau khi T037 và T038 xong): với nhà cung cấp và kích thước máy ảo đã chốt ở T038, `terraform apply` ở `infra/ci/`, tạo hai GitHub App + OAuth + webhook + bot Telegram, nhập bí mật vào `/etc/jenkins-secrets/`; xác nhận Jenkins lên với đủ thư mục, hai tác nhân trực tuyến, 0 bộ thực thi trên bộ điều khiển; ghi thời gian dựng vào mục "Lịch sử diễn tập" của `docs/ci-cd/rebuild-jenkins.md`
- [ ] T053 [US4] Chốt phần mở rộng nạp `Jenkinsfile` từ nhánh tin cậy (R4, rủi ro R-6): thử *Remote Jenkinsfile Provider* rồi *Pipeline Multibranch Defaults* bằng phép thử "pull request sửa `Jenkinsfile.ci` không đổi được định nghĩa đang chạy"; cố định cái đạt vào `ops/ci/jenkins/plugins.txt`; cả hai không đạt → dùng job Pipeline thường do Job DSL sinh cho từng pull request; ghi lựa chọn và lý do vào `specs/008-cicd-jenkins-pipeline/research.md` mục R4
- [ ] T054 [US4] Chạy quickstart B6 (job thử ở `deploy/staging/` gọi thông tin của `deploy/production/` và ngược lại → Jenkins báo không tìm thấy), B7 (tài khoản `developers` chạy `deploy/production/*` → bị từ chối, Audit Trail có dòng), B8 (webhook không chữ ký bị từ chối; `/` từ địa chỉ ngoài danh sách không vào được); kiểm thêm trên máy: `sudo -u ci-agent` không đọc được thư mục nhà của `jenkins` / `deploy-agent`, không `curl` được điểm quản trị cụm / kho ảnh riêng tư (khi đã có địa chỉ) / Telegram; đo ảnh hưởng của Docker rootless tới thời gian dựng ảnh và Chromium (rủi ro R-7); ghi kết quả vào `specs/008-cicd-jenkins-pipeline/quickstart.md`

**Checkpoint**: Jenkins tồn tại, cô lập đã được kiểm; chưa có job nghiệp vụ nào

---

## Phase 5: User Story 1 (phần B) – Chặng kiểm tra trên Jenkins chặn hợp nhất (Priority: P1)

**Goal**: mỗi pull request vào `dev` / `master` tự chạy cổng trên kết quả hợp nhất dự kiến, kết quả hiện trên pull
request, nút hợp nhất bị khóa khi chưa đạt (FR-002, FR-004, FR-010)

**Independent Test**: quickstart B1–B5 – pull request sạch được hợp nhất sau khi có người duyệt; năm pull request vi
phạm bị khóa và nêu đúng nguyên nhân; đẩy thẳng bị từ chối

- [ ] T055 [P] [US1] Viết `ops/ci/scripts/resolve-gate-env.mjs`: dùng quyền **đọc** của GitHub App "ci" lấy từ GitHub Deployments SHA triển khai thành công gần nhất của `staging` và của `production`; in ra `STAGING_DEPLOYED_SHA`, `COMPAT_BASE_SHA` (đích `dev` → bản đang chạy ở `staging`; đích `master` → bản đang chạy ở `production`; chưa từng triển khai → `none`), `GATE_TARGET_BRANCH`, `GATE_SOURCE_BRANCH`, `MIGRATION_BASE_REF=origin/<đích>`, `APP_VERSION`; kèm `tooling/test/resolve-gate-env.spec.ts` với phản hồi API giả
- [ ] T056 [US1] Viết `ops/ci/Jenkinsfile.ci` (Declarative, tác nhân nhãn `ci`): lấy kết quả hợp nhất dự kiến của pull request; khởi động PostgreSQL tạm (`TEST_POSTGRES_IMAGE` trong `ops/ci/versions.env`) và hủy ở `post`; gọi `resolve-gate-env.mjs`; chạy song song **mỗi làn của `ops/ci/gate-lanes.json` một lệnh** `pnpm verify --ci --only <các bước của làn> --report verify-report-<làn>.json` trong ảnh công cụ T049; gộp báo cáo; đăng một kiểm tra `gate/<bước>` cho từng bước (tóm tắt đủ bốn thứ của FR-010: tên cổng · `firstError` · đường dẫn nhật ký Jenkins · `rerun`; `excepted` → kết luận `neutral`, tiêu đề "VƯỢT CỔNG (ngoại lệ) – duyệt bởi …") và kiểm tra tổng **`ci/gates`** (đạt khi mọi báo cáo `passed`); cuối lần chạy xuất nhật ký ra tệp và quét bằng `node tooling/scan-secrets.mjs <tệp>` – phát hiện thì lần chạy không đạt. Bất biến: **không** có kiểm tra nào viết trong Groovy, **không** `load` tệp Groovy từ thư mục làm việc, **không** `withCredentials` nào ngoài `github-app-ci`, **không** tự chạy lại khi đỏ (FR-007, R4)
- [ ] T057 [US1] Viết `ops/ci/jenkins/jobs/ci_gates.groovy`: Multibranch `ci/gates` chỉ khám phá pull request nhắm `dev` / `master`, nạp `ops/ci/Jenkinsfile.ci` từ nhánh `dev` theo cơ chế đã chốt ở T053, webhook + quét kho mỗi 10 phút (R5), tên kiểm tra do App "ci" đăng; và `ops/ci/jenkins/jobs/ci_sandbox.groovy`: job tay `ci/sandbox` cho SA thử `Jenkinsfile.ci` của một nhánh, đăng kết quả dưới tên `ci/sandbox` (không phải tên bắt buộc)
- [ ] T058 [US1] Viết `ops/ci/github/rulesets/dev.json`, `ops/ci/github/rulesets/master.json` theo bảng research R7 (cấm đẩy thẳng / xóa / ghi đè lịch sử; kiểm tra bắt buộc `ci/gates` với nguồn là GitHub App "ci"; nhánh phải cập nhật so với đích; người duyệt theo FR-004 và kết quả T038: `ops/ci/team.json` có **một** thành viên → 0 người duyệt, không bật duyệt của chủ mã; **từ hai** thành viên → 1 người duyệt khác tác giả ở cả hai nhánh, `master` hủy duyệt cũ khi có commit mới, bật duyệt của chủ mã; `master` **chỉ merge commit** và **chỉ tài khoản có vai `release-manager` hợp nhất được** – cơ chế cụ thể chốt lúc làm theo loại tài khoản GitHub, ghi vào `research.md` mục R7; không ai được vượt luật) và `ops/ci/github/apply-rulesets.sh` (`gh api`, chạy lại được: tạo nếu chưa có, cập nhật nếu đã có, in khác biệt trước khi áp); bổ sung `tooling/check-pipeline.mjs`: `team.json` có từ hai thành viên mà ruleset không yêu cầu ≥ 1 người duyệt + duyệt của chủ mã → không đạt (để chế độ một thành viên không tồn tại lâu hơn thực tế)
- [ ] T059 [P] [US1] Viết `ops/ci/jenkins/jobs/maintenance_ruleset_drift.groovy` + `ops/ci/scripts/ruleset-drift.mjs`: hằng ngày so ruleset đang áp trên GitHub với hai tệp trong kho, lệch → báo Telegram ưu tiên cao kèm trường lệch
- [ ] T060 [US1] 🖐 TAY (trợ lý chuẩn bị lệnh, **chủ dự án xác nhận từng bước** – thao tác hướng ra ngoài): đưa nhánh làm việc của 008 vào `dev` để `Jenkinsfile.ci` có trên nhánh tin cậy; tạo nhánh `master` từ `dev` trên GitHub; đặt nhánh mặc định theo quyết định của đội; chạy `ops/ci/github/apply-rulesets.sh`; nạp lại JCasC. Từ thời điểm này `dev` cấm đẩy thẳng: mọi thay đổi còn lại của 008 (Phase 6–8) đi bằng pull request từ `impl/008-cicd-jenkins-pipeline` vào `dev`, qua `ci/gates`; khi kết thúc implement **không** chọn hợp nhất cục bộ ở `/speckit-worktree-finish` – giữ worktree và mở pull request
- [ ] T061 [US1] Chạy quickstart B1 (pull request sạch: `ci/gates` + từng `gate/<bước>` hiện trên pull request; đo thời gian so với SC-003 ≤ 15 phút) và B3 (`git push origin dev` trực tiếp và hợp nhất khi `ci/gates` đang chạy → GitHub từ chối); quá 15 phút → chỉnh `ops/ci/gate-lanes.json` và bộ nhớ đệm pnpm store / lớp ảnh theo tác nhân (rủi ro R-8)
- [ ] T062 [US1] Chạy quickstart B2 (đẩy năm nhánh vi phạm của T036 thành năm pull request → cả 5 bị khóa, mỗi `gate/<bước>` đủ bốn thứ của FR-010), B4 (pull request sửa `ops/ci/Jenkinsfile.ci` để `echo` biến môi trường và gọi `withCredentials` → vẫn chạy bản của `dev`, nhật ký không có thông tin nào), B5 (pull request thêm `pretest` in `env`, thử `docker push`, `curl` điểm quản trị cụm → không có biến thông tin triển khai, kết nối bị chặn), B11 (quét nhật ký 20 lần chạy gần nhất → 0 phát hiện); so kết quả từng cổng với máy cá nhân trên cùng commit (SC-012); đóng các pull request thử; ghi kết quả vào `specs/008-cicd-jenkins-pipeline/quickstart.md`

**Checkpoint**: US1 hoàn tất – SC-001, SC-002, SC-003 (phần cổng), SC-012 kiểm được; US4 kiểm đủ B4–B8, B11

---

## Phase 6: User Story 2 – Hợp nhất vào `dev` thì môi trường test tự cập nhật (Priority: P2)

**Goal**: sau hợp nhất vào `dev`, Jenkins tự chạy cổng → dựng một ảnh → migration → `api` + `worker` → web → kiểm tra
khói → thông báo, không thao tác tay (FR-027…037, FR-043…045)

**Independent Test**: khi chưa có `staging`: quickstart B9, B10 (quy trình tự chạy tới "chưa có môi trường đích"). Khi
có `staging` (⏳ 007): quickstart C1–C10

### Mã ứng dụng cho kiểm tra khói và quay về an toàn (module `queue`, schema `infra` · R18, R22)

- [X] T063 [US2] Thêm bảng `smokePings` vào `apps/server/src/modules/queue/internal/db/schema.ts` bằng khuôn bảng dùng chung (`sharedTable` – không có `account_id`): `id` `uuid` PK (UUID v7 sinh ở ứng dụng), `requested_at` `timestamptz NOT NULL`, `api_version` `text NOT NULL`, `processed_at` `timestamptz` (nullable), `worker_version` `text` (nullable); sinh migration `apps/server/drizzle/migrations/0014_infra_smoke_pings.sql` (số kế tiếp sau `0013`, chỉ thêm – tương thích ngược) với quyền: `app` được `INSERT`, `SELECT`; `system` được `SELECT`, `UPDATE (processed_at, worker_version)`; `support` **không có quyền**; cập nhật sổ đăng ký bảng / miễn trừ của kiểm thử truy cập chéo (bảng dùng chung, không dữ liệu khách hàng) để `pnpm test:db` và `pnpm db:lint-migrations` đạt
- [X] T064 [US2] Viết `apps/server/src/modules/queue/internal/smoke/smoke-token.guard.ts` (đọc `SMOKE_TOKEN`; so sánh bằng `timingSafeEqual`; thiếu tiêu đề `X-Smoke-Token`, sai mã, **hoặc thiếu biến `SMOKE_TOKEN`** → ném 404 giống hệt đường dẫn không tồn tại) và `smoke.controller.ts`: `POST /ops/smoke` → 202 `{ "id": "<uuid>" }`, trong **một** giao dịch vai trò `app` không gắn tenant (`authTx` của `apps/server/src/core/db/auth-tx.ts` – `systemTx` chỉ chạy ở Worker; FR-032 đòi ghi–đọc bằng vai trò ứng dụng) ghi dòng `infra.smoke_pings` (`api_version` = `APP_VERSION`) và tạo việc hệ thống `queue.smoke_ping` qua hàm tạo việc công khai của module `queue`; mở rộng danh sách cho phép của luật ranh giới `auth-tx-restricted` thêm `modules/queue/internal/smoke/**` kèm chú thích lý do (bảng dùng chung, không có dữ liệu khách hàng); nếu hàm tạo việc không nhận loại giao dịch này thì **dừng và báo lại** – không đổi sang cấp `INSERT` cho `system`; `GET /ops/smoke/:id` → 200 `{ id, requestedAt, apiVersion, processedAt | null, workerVersion | null }`, không thấy → 404; khai báo `@Public` + bộ gác trên; giới hạn 10 yêu cầu/phút mỗi bản API; thêm `SMOKE_TOKEN` (tùy chọn) vào lược đồ cấu hình và `apps/server/.env.example`; đăng ký controller trong `queue.module.ts` chỉ cho vai `api` (giữ đúng `modules.manifest.json`, `pnpm check:boundaries` đạt)
- [X] T065 [US2] Đăng ký loại việc `queue.smoke_ping` trong `apps/server/src/modules/queue/job-types.ts` và viết `apps/server/src/modules/queue/internal/smoke/smoke-ping.handler.ts`: `UPDATE infra.smoke_pings SET processed_at = now(), worker_version = <APP_VERSION> WHERE id = $1 AND processed_at IS NULL` (cập nhật có điều kiện → chạy lại an toàn); bổ sung `apps/server/src/modules/queue/internal/maintenance.ts` xóa dòng `smoke_pings` cũ hơn 7 ngày trong việc dọn dẹp hằng ngày đã có
- [X] T066 [US2] Rà và sửa hành vi loại việc chưa đăng ký ở phía xử lý trong `apps/server/src/modules/queue/internal/runtime/job-runner.ts` (và `bury.ts` nếu liên quan) theo R22: việc được **trả lại hàng chờ** với giờ chạy lùi 5 phút, **không** tính lần thử, **không** chuyển sang `infra.dead_jobs`, ghi cảnh báo `queue.unknown_job_type` kèm chỉ số trong `internal/observability.ts`; thêm luật cảnh báo tương ứng vào `ops/alerts/queue.rules.yml`
- [X] T067 [P] [US2] Viết `apps/server/test/ops/smoke.e2e.spec.ts`: thiếu / sai `X-Smoke-Token` → 404; không đặt `SMOKE_TOKEN` → 404 kể cả khi gửi mã; đúng mã → 202 rồi `GET` trả `apiVersion`, `processedAt: null`; quá 10 yêu cầu/phút bị giới hạn; phản hồi không chứa dữ liệu tài khoản nào
- [X] T068 [P] [US2] Viết `apps/server/test/queue/smoke-ping.queue.spec.ts` (dòng và việc được tạo trong cùng giao dịch – giao dịch hủy thì không có cả hai; bộ xử lý chạy **hai lần** cho cùng kết quả, `worker_version` không bị ghi đè; dòng cũ hơn 7 ngày bị dọn) và `apps/server/test/queue/unknown-job-type.queue.spec.ts` (việc loại lạ còn trong hàng chờ với giờ chạy lùi ~5 phút, số lần thử không tăng, `infra.dead_jobs` không có dòng mới, có cảnh báo `queue.unknown_job_type`); thêm `smoke_pings` vào tập `test:compat` nếu phù hợp hợp đồng T027

### Định nghĩa triển khai (`ops/deploy/**` · R15, R16, R18, R20)

- [ ] T069 [P] [US2] Viết Helm chart `ops/deploy/chart/` (`Chart.yaml`, `values.yaml`, `values.schema.json`, `templates/{_helpers.tpl,deployment-api.yaml,deployment-worker.yaml,service.yaml,ingress.yaml,pdb.yaml,configmap.yaml}`) đúng các bất biến của contracts/deploy-pipeline.md mục 3: hai Deployment dùng **cùng** `image.repository@image.digest`, khác `command`; nhãn `app.kubernetes.io/version` = `appVersion`; **không** định nghĩa `Secret` và không có giá trị bí mật – chỉ `envFrom` tên Secret `envFromSecret`; không Deployment nào gắn Secret `owner`; `api`: `readinessProbe` `/readyz`, `livenessProbe` `/healthz`, `preStop` chờ 5 giây, `maxUnavailable: 0`, `maxSurge: 1`; `worker`: `terminationGracePeriodSeconds: 40`, `SHUTDOWN_TIMEOUT_MS=30000`, dò sức khỏe cổng 3001, `maxUnavailable: 0`; PDB `minAvailable: 1` cho từng Deployment; container không phải root, hệ tệp gốc chỉ đọc; `config.*` vào ConfigMap (`APP_ENV`, `CORS_ORIGINS`, trình điều khiển cổng…)
- [ ] T070 [P] [US2] Viết `ops/deploy/migrate-job.yaml` (mẫu ngoài chart, thay biến bằng `envsubst`/tập lệnh): Job tên `migrate-<sha12>` ở namespace `cluster.namespaces.migrate`, ảnh theo digest của bản phát hành, lệnh `node dist/db/migrate.js`, `backoffLimit: 0`, `ttlSecondsAfterFinished: 604800`, `APP_ENV` của môi trường, `DATABASE_OWNER_URL` lấy từ Secret `secrets.dbOwner`, không phải root, hệ tệp gốc chỉ đọc
- [ ] T071 [P] [US2] Viết `ops/deploy/scripts/render-values.mjs`: đọc `ops/deploy/env/<env>.yaml` (kiểm theo `schema.json`) + `--sha` + `--digest` → in tệp giá trị Helm theo bảng contracts/deploy-pipeline.md mục 3; từ chối khi `--env` ≠ `name` trong tệp; kèm `tooling/test/render-values.spec.ts`
- [ ] T072 [P] [US2] Viết `ops/deploy/scripts/publish-web.mjs` (`@aws-sdk/client-s3` đã có trong kho mã) theo contracts/deploy-pipeline.md mục 4: `--env <env> --sha <sha>` dựng `@app/web` với `web.buildEnv`, tải `assets/*` (tên có mã băm, `Cache-Control: public, max-age=31536000, immutable`, **không xóa tệp cũ**), ghi `releases/<sha>/index.html` và `releases/<sha>/manifest.json`; `--activate` ghi `index.html` (`Cache-Control: no-cache`) **cuối cùng**; `--rollback-to <sha>` chép `releases/<sha>/index.html` thành `index.html`; `--prune` chỉ xóa tệp `assets/` không thuộc manifest của bản hiện hành và của mọi bản được kích hoạt trong 7 ngày gần nhất; mọi thao tác chạy lại được; kèm `tooling/test/publish-web.spec.ts` (S3 giả: thứ tự tải, `index.html` cuối, quay về, dọn theo manifest)
- [ ] T073 [P] [US2] Viết `ops/deploy/smoke/smoke.mjs` (`--env <env> --expect-version <sha>`, chỉ qua HTTPS công khai, đọc `SMOKE_TOKEN`, `SMOKE_USER`, `SMOKE_PASSWORD` từ biến môi trường, không in giá trị): bốn mục của contracts/deploy-pipeline.md mục 5 – `api.health` (`/healthz`, `/readyz` → 200, `version` = SHA), `db+queue` (`POST /ops/smoke` rồi thăm dò `GET /ops/smoke/{id}` ≤ 60 giây tới khi `processedAt` có giá trị và `apiVersion` = `workerVersion` = SHA), `login` (đăng nhập tài khoản kiểm tra nội bộ rồi đăng xuất), `web` (`GET /` 200 qua HTTPS, `index.html` khớp `releases/<sha>/index.html`, tải được tệp JS chính); in một dòng kết quả mỗi mục; mã thoát `0` khi đạt cả bốn; tổng thời hạn `smoke.timeoutSeconds`; MUST NOT gọi nền tảng mạng xã hội, nhà cung cấp AI hay gửi email; kèm `tooling/test/smoke.spec.ts` với máy chủ HTTP giả (lệch phiên bản, `processedAt` không bao giờ có → không đạt)
- [ ] T074 [P] [US2] Viết `ops/ci/scripts/deployment-record.mjs` (App "deploy"): `start` tạo GitHub Deployment (`environment`, `ref` = SHA, trạng thái `in_progress`); `finish` ghi `payload` đúng lược đồ `DeploymentRecord` ở data-model.md mục 4 (`schema: 1`, `environment` ∈ `staging`|`production`, `kind` ∈ `release`|`hotfix`|`redeploy`, `commit`, `image { repository, digest, reused }`, `mergedBy`, `approvedBy[]`, `pullRequest`, `jenkins { job, build, url }`, `gates { passed, excepted[] }`, `vulnerabilities { critical, criticalFixable, blocked }`, `migrations[]`, `steps[] { name, status, seconds }`, `rolledBack`, `previous { commit, digest, helmRevision }`, `redeploy`, `notifyErrors[]`) và trạng thái theo ánh xạ: `succeeded` → `success`; `rolled_back` → `failure` mô tả "đã quay về bản trước"; `stopped_before_change` → `failure` nêu bước hỏng; `no_target` → **không tạo** Deployment; `last-success --env <env>` trả bản ghi thành công gần nhất; lấy `mergedBy` / `approvedBy` / `pullRequest` từ pull request chứa commit; bản ghi MUST NOT chứa bí mật, địa chỉ nội bộ ngoài đường dẫn Jenkins, nội dung nhật ký; kèm `tooling/test/deployment-record.spec.ts`
- [ ] T075 [P] [US2] Viết `ops/ci/scripts/notify-telegram.mjs` theo contracts/deploy-pipeline.md mục 8: bốn khuôn tin (`✅ … · thành công`, `❌ … · hỏng ở bước <tên> (môi trường giữ nguyên)`, `⚠️ … · ĐÃ QUAY VỀ BẢN TRƯỚC (hỏng ở <tên>)`, `ℹ️ … · chưa có môi trường đích`) gồm môi trường, SHA rút gọn 12 ký tự, tác giả, số pull request, thời lượng, số migration, số lỗ hổng nghiêm trọng, ngoại lệ đã dùng, đường dẫn Jenkins; `production` hỏng / đã quay về → dòng đầu `🚨 ƯU TIÊN CAO` + nhắc tên Telegram của người hợp nhất và nhóm trực theo `ops/ci/team.json`; thử lại 3 lần (5 s, 30 s, 120 s); vẫn lỗi → thoát mã 0 và in JSON lỗi để ghi `notifyErrors`; tin MUST NOT chứa bí mật, nhật ký thô, dữ liệu khách hàng, địa chỉ nội bộ; kèm `tooling/test/notify-telegram.spec.ts`
- [ ] T076 [P] [US2] Viết `ops/deploy/scripts/release-image.mjs`: hỏi kho ảnh thẻ `<sha>` đã có chưa → có thì **dùng lại, không đẩy đè** (`reused: true`), chưa có thì `docker buildx build --build-arg APP_VERSION=<sha>` + đẩy; trả digest `sha256:…`; quét `trivy image` cục bộ theo `--policy block|warn`: `block` → thoát khác 0 khi có lỗ hổng mức nghiêm trọng **đã có bản vá**, `warn` → chỉ in số lượng; tôn trọng `.trivyignore` (mỗi mục phải có lý do và ngày hết hạn – kiểm trong `tooling/check-pipeline.mjs`); kèm `tooling/test/release-image.spec.ts` (kho ảnh và trivy giả)

### Chặng triển khai trên Jenkins

- [ ] T077 [US2] Viết `ops/ci/Jenkinsfile.deploy` (tác nhân nhãn `deploy`, dùng chung hai môi trường, tham số duy nhất là tên môi trường lấy từ thư mục job) đúng contracts/deploy-pipeline.md mục 1–2: dừng ngay nếu nhánh ≠ `EnvironmentParams.branch` hoặc thư mục job ≠ `EnvironmentParams.name`; `disableConcurrentBuilds()` (không hủy lần đang chạy) + khóa `deploy-<env>` bao bước 2–6; **(1) `gates`** `pnpm verify --ci` đầy đủ theo làn với `COMPAT_BASE_SHA` = bản đang chạy ở chính môi trường này; **(2) `image`** `release-image.mjs`; **cửa môi trường** `provisioned: false` → kết thúc "chưa có môi trường đích" (không đỏ, tin `ℹ️`, không tạo Deployment); **(3) `migrate`** áp `migrate-job.yaml` – Job cùng tên đã thành công thì bỏ qua – chờ xong, lấy nhật ký → danh sách tệp đã áp, lỗi → dừng (ứng dụng chưa đổi); **(4) `rollout`** `HELM_DRIVER=configmap helm upgrade --install app ops/deploy/chart --atomic --wait --timeout 8m` với giá trị từ `render-values.mjs`; **(5) `web`** `publish-web.mjs` rồi `--activate`; **(6) `smoke`** `smoke.mjs`; bước 5 hoặc 6 hỏng → `helm rollback app <bản trước> --wait` + `publish-web.mjs --rollback-to <sha trước>`, ghi `rolledBack: true`; **(7) `notify`** `deployment-record.mjs finish` + `notify-telegram.mjs` bọc `catchError` (không đổi kết quả triển khai); cuối lần chạy quét nhật ký bằng `tooling/scan-secrets.mjs` (phát hiện → không đạt + tin ưu tiên cao); mọi thông tin qua `withCredentials`, lệnh chạy `set +x`; không có bước chờ người xác nhận; không có logic kiểm tra trong Groovy
- [ ] T078 [US2] Viết `ops/ci/jenkins/jobs/deploy.groovy`: `deploy/staging/deploy` (chỉ nhánh `dev`) và `deploy/production/deploy` (chỉ nhánh `master`) – Pipeline lấy `ops/ci/Jenkinsfile.deploy` từ chính nhánh đó, kích hoạt bằng webhook `push` + thăm dò 5 phút, khóa `deploy-staging` / `deploy-production` (Lockable Resources), giữ lần chạy 400 ngày; và `ops/ci/jenkins/jobs/maintenance_prune_web.groovy` (hằng ngày, mỗi môi trường đã `provisioned`: `publish-web.mjs --prune`)
- [ ] T079 [US2] Cập nhật `ops/ci/gate-lanes.json` và `tooling/check-pipeline.mjs` cho những gì phase này thêm: `helm lint` + `helm template` chart với giá trị sinh từ cả hai tệp tham số; `migrate-job.yaml` và mọi mẫu chart không chứa `kind: Secret`; `.trivyignore` hợp lệ; chạy `pnpm verify` đầy đủ trên máy cá nhân và quickstart A5 → đạt
- [ ] T080 [US2] Chạy quickstart B9 (hợp nhất một pull request vào `dev` → `deploy/staging/deploy` tự chạy trong ≤ 2 phút: cổng đạt, ảnh dựng được, kết thúc "chưa có môi trường đích", tin Telegram `ℹ️`) và B10 (tắt webhook trong GitHub rồi hợp nhất → job vẫn tự chạy trong ≤ 5 phút nhờ thăm dò; bật lại webhook); ghi kết quả vào `specs/008-cicd-jenkins-pipeline/quickstart.md`
- [ ] T081 [US2] ⏳ 007 🖐 TAY – Khi `staging` đáp ứng `specs/008-cicd-jenkins-pipeline/contracts/environment-inputs.md`: điền `ops/deploy/env/staging.yaml` từ danh sách đầu ra của 007 và đặt `provisioned: true` (qua pull request); SA nhập `registry`, `kubeconfig`, `static-site`, `smoke` vào `deploy/staging/` theo `docs/ci-cd/credentials.md`; tạo tài khoản kiểm tra nội bộ bằng lệnh vận hành; cập nhật đích trong tường lửa (T041); khớp lại tên Secret / namespace / chính sách chấp nhận ảnh với kế hoạch của 007 (rủi ro R-4, R-5)
- [ ] T082 [US2] ⏳ 007 – Chạy quickstart C1–C10 trên `staging` (triển khai không thao tác tay ≤ 25 phút; kiểm tra khói tay; 0 yêu cầu lỗi và 50 việc xử lý đúng một lần trong lúc `rollout`; hai lần hợp nhất sát nhau; bản `worker` không khởi động được → tự quay về ≤ 10 phút; migration lỗi → dừng trước khi đổi ứng dụng; chạy lại lần đã xong không tạo thay đổi; tệp `assets/` bản trước còn truy cập; mã bot sai không làm hỏng triển khai) – riêng C8 làm sau T085; ghi số đo SC-003, SC-005, SC-006, SC-007 vào `specs/008-cicd-jenkins-pipeline/quickstart.md`

**Checkpoint**: US2 hoàn tất về mã (kiểm được tới "chưa có môi trường đích"); chạy thật chờ 007

---

## Phase 7: User Story 3 – Hợp nhất vào `master` thì môi trường release tự cập nhật, an toàn (Priority: P3)

**Goal**: release dùng cùng định nghĩa với test, thêm các lớp an toàn: nguồn phát hành, chặn lỗ hổng, triển khai lại bản
cũ, sửa nóng + backmerge (FR-005…005b, FR-026, FR-034)

**Independent Test**: ⏳ 007 – quickstart D1–D10. Phần không cần môi trường: kiểm thử tự động của T084, T086 và phép
thử `check:release-source` ở quickstart A3

- [ ] T083 [P] [US3] Tạo `.trivyignore` ở gốc kho (ban đầu rỗng, đầu tệp ghi quy ước: mỗi mục kèm chú thích lý do + ngày hết hạn `# expires: YYYY-MM-DD`) và soát `ops/deploy/env/production.yaml`: `vulnerabilityPolicy: block`, `branch: master`, số bản chạy `api` ≥ 2 để `maxUnavailable: 0` + PDB có nghĩa
- [ ] T084 [P] [US3] Viết `ops/ci/scripts/backmerge.mjs` (App "deploy") theo contracts/deploy-pipeline.md mục 7: tạo nhánh `backmerge/<sha12>` từ đầu `master`, mở pull request vào `dev` tiêu đề "Backmerge sửa nóng <sha12>", gắn nhãn `backmerge`; có xung đột → pull request **vẫn mở**, thêm nhãn `needs-manual-merge`; đã có pull request cùng nhánh → không tạo trùng (chạy lại an toàn); in số pull request để đưa vào tin Telegram; kèm `tooling/test/backmerge.spec.ts` (API GitHub giả: tạo mới, đã tồn tại, xung đột)
- [ ] T085 [US3] Viết `ops/ci/Jenkinsfile.redeploy` + `ops/ci/jenkins/jobs/redeploy.groovy` (`deploy/staging/redeploy`, `deploy/production/redeploy`) theo contracts/deploy-pipeline.md mục 6: tham số `VERSION` (SHA đã từng triển khai **thành công** lên chính môi trường này – tra bằng `deployment-record.mjs`), `REASON` (bắt buộc, khác rỗng), `ACK_OLDER_THAN_PREVIOUS` (bắt buộc đánh dấu nếu `VERSION` không phải bản liền trước; job in cảnh báo: tương thích ngược chỉ được kiểm với bản liền trước); **không** dựng ảnh, **không** chạy migration; lấy digest từ `DeploymentRecord` của `VERSION`, kiểm ảnh còn trong kho; chạy bước 4–7 dưới cùng khóa `deploy-<env>`; `DeploymentRecord.kind = "redeploy"`, `redeploy = { requestedBy: <người bấm>, reason }`; quyền chạy: `production` chỉ `release-managers`, `staging` thêm `developers` (khớp `casc/security.yaml`)
- [ ] T086 [US3] Bổ sung `ops/ci/Jenkinsfile.deploy` + `ops/ci/scripts/deployment-record.mjs`: xác định `kind = "hotfix"` khi pull request nguồn của commit trên `master` có nhánh `hotfix/*`; sau bước `smoke` đạt của một lần sửa nóng → gọi `backmerge.mjs` và đưa số pull request (kèm nhãn `needs-manual-merge` nếu có) vào tin Telegram, trong ≤ 10 phút (SC-009); bổ sung ca kiểm thử `kind` vào `tooling/test/deployment-record.spec.ts`
- [ ] T087 [P] [US3] Viết `ops/ci/scripts/rerun-release-gates.mjs` và gọi ở cuối lần triển khai `staging` thành công trong `ops/ci/Jenkinsfile.deploy`: tìm pull request `dev` → `master` đang mở và yêu cầu chạy lại `ci/gates` của nó (để `check:release-source` chuyển xanh mà không ai phải bấm – R8); không có pull request nào → không làm gì; lỗi gọi API không làm hỏng triển khai
- [ ] T088 [P] [US3] Viết `ops/ci/jenkins/jobs/maintenance_prune_images.groovy` + `ops/ci/scripts/prune-images.mjs`: hằng tuần, mỗi môi trường đã `provisioned`: giữ ảnh của **10 lần triển khai release gần nhất** (lấy từ GitHub Deployments) **và** mọi ảnh dưới **90 ngày**, xóa phần còn lại qua API kho ảnh; có `--dry-run` (mặc định khi chạy tay); kèm `tooling/test/prune-images.spec.ts` cho luật chọn ảnh giữ / xóa (FR-025)
- [ ] T089 [US3] ⏳ 007 🖐 TAY – Khi `production` sẵn sàng: điền `ops/deploy/env/production.yaml`, `provisioned: true`; SA nhập thông tin vào `deploy/production/`; tạo tài khoản kiểm tra nội bộ ở release; xác nhận ruleset `master` đang áp và `maintenance/ruleset-drift` xanh
- [ ] T090 [US3] ⏳ 007 – Chạy quickstart D1–D10 (nguồn phát hành chưa qua test bị chặn rồi tự xanh lại; tài khoản không có vai `release-manager` không hợp nhất được vào `master` – và khi đội có từ hai người thì tự duyệt không hợp nhất được; hợp nhất → release tự triển khai ≤ 30 phút; nguồn lạ bị từ chối; sửa nóng + backmerge ≤ 10 phút; phát hành thường bị chặn khi backmerge chưa hợp nhất; hotfix lẫn commit của `dev` bị chặn; lỗ hổng nghiêm trọng có bản vá: test cảnh báo, release dừng ở `image`; tra một lần triển khai ≤ 5 phút; soát dữ liệu sau kiểm tra khói) và C8 (`redeploy` trên `staging`); ghi số đo SC-004, SC-009, SC-011 vào `specs/008-cicd-jenkins-pipeline/quickstart.md`

**Checkpoint**: cả bốn câu chuyện hoàn tất về mã; phần chạy thật theo tiến độ của 007

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: tài liệu FR-046, cập nhật tài liệu dự án, diễn tập SC-013 / SC-014, soát hiến pháp

- [ ] T091 [P] Viết `docs/ci-cd/branching-and-release.md` (luồng nhánh theo sơ đồ contracts/quality-gates.md mục 4, phát hành thường `dev` → `master` bằng merge commit, sửa nóng `hotfix/*`, backmerge, cách xem môi trường đang chạy bản nào trên trang Environments của GitHub – FR-045) và `docs/ci-cd/gates.md` (bảng 17 cổng: ý nghĩa, lệnh `pnpm verify --only …`, điều kiện cần, có cho ngoại lệ không; cách đọc `gate/<bước>` trên pull request; hợp đồng `test:compat` và cảnh báo rủi ro R-10)
- [ ] T092 [P] Viết `docs/ci-cd/backward-compatible-migrations.md` (mở rộng → chuyển mã → thu hẹp; từng luật tĩnh kèm cách chia bước; `-- breaking-ok:` và điều kiện `db:compat`; migration bất biến; sửa nóng có kèm migration – viết theo kết quả T021) và `docs/ci-cd/rollback.md` (tự quay về hoạt động thế nào, vì sao CSDL chỉ đi tới, cách dùng `redeploy` và cảnh báo bản cũ hơn bản liền trước, hành vi loại việc lạ sau khi quay về)
- [ ] T093 [P] Viết `docs/ci-cd/gate-exceptions.md` (quy trình bốn bước của contracts/quality-gates.md mục 6, lược đồ tệp, danh sách cổng **không** cho ngoại lệ và lý do, ví dụ tệp hợp lệ) và `docs/ci-cd/emergency-deploy.md` (khi Jenkins ngừng: SA dùng `ops/deploy/**` từ máy mình theo đúng thứ tự bước, rồi tạo tay một GitHub Deployment ghi chú "manual" để lịch sử không đứt – contracts/jenkins-platform.md mục 8)
- [ ] T094 Hoàn thiện `docs/ci-cd/rebuild-jenkins.md` và `docs/ci-cd/credentials.md` từ bản đầu của T051 bằng những gì thực tế gặp ở T052–T054, T081, T089 (thứ tự, thời gian từng bước, lỗi thường gặp, việc phải làm khi quét nhật ký phát hiện bí mật: xoay thông tin nào); mỗi tài liệu có mục "Lịch sử diễn tập"
- [ ] T095 [P] Cập nhật `.specify/memory/architecture.md` mục 11 (thêm bảng thuật ngữ ở data-model.md mục 9) và mục phát hành nếu lệch; cập nhật `README.md` và `CLAUDE.md`: trỏ tới `docs/ci-cd/`, nhánh phát hành là `master`, ADR-11 nằm ở `docs/adr/`, lệnh `pnpm verify --ci` / `--only`
- [ ] T096 Cập nhật `CLAUDE.md` (mục Gotchas về worktree) và `.claude/skills/speckit-worktree-finish/SKILL.md`: khi nhánh gốc được bảo vệ (đẩy thẳng bị từ chối) thì bước kết thúc là đẩy nhánh `impl/<feature>` và mở pull request vào nhánh gốc, không `merge --no-ff` cục bộ; worktree chỉ dọn sau khi pull request đã hợp nhất
- [ ] T097 Diễn tập SC-014 (quickstart B12): hủy máy ảo, `terraform apply`, nhập lại bí mật chỉ theo `docs/ci-cd/rebuild-jenkins.md`; đạt khi Jenkins chạy lại đủ job trong ≤ 4 giờ, lịch sử triển khai vẫn tra được trên GitHub và ứng dụng ở hai môi trường không bị ảnh hưởng; ghi thời gian vào "Lịch sử diễn tập" – 🖐 TAY, **chỉ làm khi chủ dự án xác nhận** (hủy tài nguyên thật)
- [ ] T098 Diễn tập SC-013 và tài liệu khẩn cấp (quickstart E): một người chưa làm 008, chỉ theo `docs/ci-cd/branching-and-release.md` và `docs/ci-cd/gates.md`, đưa một thay đổi nhỏ lên test trong ngày đầu; diễn tập `docs/ci-cd/emergency-deploy.md` một lần trên test với Jenkins tắt (⏳ 007); ghi thời gian và câu hỏi phát sinh, sửa tài liệu theo đó
- [ ] T099 Chạy `pnpm verify --ci --report verify-report.json` trên nhánh cuối (mọi cổng đạt, không ngoại lệ nào còn trong `ops/ci/exceptions/`), chạy `/constitution-review` trên toàn bộ thay đổi của 008 (trọng tâm nguyên tắc I, VII, IX) và sửa các điểm nêu ra; cập nhật `specs/008-cicd-jenkins-pipeline/plan.md` mục Rủi ro với trạng thái cuối của R-1…R-11

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup** → không phụ thuộc gì
- **Phase 2 Foundational** → sau Phase 1; **chặn mọi phase sau**
- **Phase 3 (US1 phần A)** → sau Phase 2; không cần Jenkins, không cần môi trường – **MVP**
- **Phase 4 (US4)** → sau Phase 2 (dùng `versions.env`, `check:pipeline`); độc lập với Phase 3 nên có thể làm song song.
  T037 (ADR được chấp nhận) và T038 (điểm quyết định) chặn T052
- **Phase 5 (US1 phần B)** → cần Phase 3 **và** Phase 4; ruleset (T058) viết theo kết quả T038
- **Phase 6 (US2)** → mã ứng dụng (T063–T068) và `ops/deploy/**` (T069–T076) chỉ cần Phase 2 + T025 (ảnh) nên làm sớm
  được; T077–T080 cần Phase 5; T081–T082 cần `staging` của 007
- **Phase 7 (US3)** → cần Phase 6 (T074, T077); T089–T090 cần `production` của 007
- **Phase 8 Polish** → T091–T093, T095 viết được ngay khi phase tương ứng xong; T094, T097, T098 cần Jenkins thật

### User Story Dependencies

- **US1 (P1)**: phần A độc lập hoàn toàn; phần B phụ thuộc US4 (nền tảng Jenkins) – phụ thuộc có chủ đích theo plan.md
- **US4 (P4)**: nền tảng dựng độc lập; phép thử B4, B5, B11 của nó dùng job `ci/gates` của US1 phần B (T062)
- **US2 (P2)**: phụ thuộc US1 (cổng là bước 1 của triển khai) và US4 (tác nhân `deploy`, thông tin theo thư mục)
- **US3 (P3)**: phụ thuộc US2 (cùng `Jenkinsfile.deploy`, `DeploymentRecord`) và `check:release-source` của US1

### Phụ thuộc ngoài

| Việc | Chờ |
|---|---|
| T052, T097 | tài khoản đám mây trong nước, ngân sách máy ảo (plan R-3) |
| T038 → T052, T058 | nhà cung cấp và ngân sách máy ảo (R-3); gói GitHub cho ruleset trên kho riêng tư (R-1); số thành viên thật của kho (R-2) |
| T081, T082, T089, T090, một phần T098 | môi trường của 007 theo `contracts/environment-inputs.md` (R-4) |
| T037 → T052 | chủ dự án bổ sung lý do ở ADR-11 mục 5, SA duyệt |

### Within Each User Story

- Công cụ trước, kiểm thử của công cụ song song với nó, rồi mới thêm bước vào `DEFAULT_STEPS` + `gate-lanes.json`
- Các việc cùng sửa `tooling/verify.mjs` (T007, T008, T014, T020, T025, T028, T030, T032), `ops/ci/gate-lanes.json`,
  `tooling/check-pipeline.mjs` (T014, T033, T058, T079) hoặc `ops/ci/Jenkinsfile.deploy` (T077, T086, T087) làm **tuần tự**
- Mã ứng dụng: schema + migration (T063) → điểm cuối (T064) → bộ xử lý (T065) → kiểm thử (T067, T068)

### Parallel Opportunities

- Phase 1: T003–T006
- Phase 2: T009–T013 sau khi T007–T008 xong; T015 cùng lúc T014
- Phase 3: năm nhóm cổng độc lập về tệp – T016/T017, T018/T019, T022–T024, T026, T029, T031, T034 chạy song song
- Phase 4: T039–T044, T047, T049, T050 song song (tệp khác nhau)
- Phase 6: T067–T068 song song; T069–T076 song song (mỗi việc một tệp / thư mục riêng)
- Phase 7: T083, T084, T087, T088 song song
- Phase 8: T091–T093, T095 song song
- Phase 3 và Phase 4 song song với nhau; T063–T076 song song với Phase 4–5

---

## Parallel Example: User Story 1 (phần A)

```text
# Sau T007–T008, mở cùng lúc năm nhóm cổng (tệp khác nhau):
Task: "T016 luật mới trong apps/server/src/db/lint-migrations.ts"
Task: "T018 apps/server/src/db/check-immutable.ts"
Task: "T022 bao phủ theo catalog trong apps/server/test/db/cross-tenant-coverage.db.spec.ts"
Task: "T023 kiểm kê đường vào apps/server/test/db/access-path-inventory.db.spec.ts"
Task: "T024 apps/server/test/db/ownership.db.spec.ts"

# Rồi tuần tự các việc cùng chạm tooling/verify.mjs:
T020 → T025 → T028 → T030 → T032
```

## Parallel Example: User Story 2

```text
# ops/deploy/** và ops/ci/scripts/** – mỗi việc một tệp:
Task: "T069 Helm chart ops/deploy/chart/"
Task: "T070 ops/deploy/migrate-job.yaml"
Task: "T072 ops/deploy/scripts/publish-web.mjs"
Task: "T073 ops/deploy/smoke/smoke.mjs"
Task: "T074 ops/ci/scripts/deployment-record.mjs"
Task: "T075 ops/ci/scripts/notify-telegram.mjs"
Task: "T076 ops/deploy/scripts/release-image.mjs"
```

---

## Implementation Strategy

### MVP First (US1 phần A – không tốn chi phí hạ tầng)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3: các cổng mới trên máy cá nhân
3. **DỪNG và KIỂM CHỨNG**: quickstart A1–A4, bộ năm vi phạm bị chặn 5/5 (SC-002)
4. Giá trị ngay: `pnpm verify --ci` là cổng đầy đủ chạy tay trước mỗi lần hợp nhất, kể cả khi chưa có Jenkins

### Incremental Delivery

1. MVP (Phase 1–3) → cổng đầy đủ trên máy cá nhân
2. Mã không cần hạ tầng của Phase 6 (T063–T076) – làm được trong lúc chờ quyết định về máy ảo và gói GitHub
3. Phase 4 → ADR-11 được chấp nhận, quyết định ở T038, rồi Jenkins dựng xong, cô lập đã kiểm
4. Phase 5 → hợp nhất bị chặn thật sự
5. Phase 6 (T077–T080) → hợp nhất vào `dev` tự chạy tới "chưa có môi trường đích"
6. Khi 007 có `staging` → T081–T082; khi có `production` → Phase 7 chạy thật
7. Phase 8 → tài liệu, diễn tập, soát hiến pháp

### Điểm dừng chờ quyết định của chủ dự án

- T037: lý do chọn Jenkins trong ADR-11 – phải xong trước khi dựng máy ảo
- T038: gói GitHub, nhà cung cấp và chi phí máy ảo, số thành viên của kho (chế độ một thành viên của FR-004)
- T060, T097: thao tác hướng ra ngoài / hủy tài nguyên – cần xác nhận từng lần

---

## Notes

- Không có kiểm tra nào chỉ tồn tại trong `Jenkinsfile` (FR-007): việc nào thêm kiểm tra thì thêm vào `tooling/` hoặc
  `apps/server`, không viết trong Groovy
- Mỗi lần cố định phiên bản (plugins.txt, versions.env, digest ảnh) phải tra bản phát hành hiện hành và mã băm chính
  thức lúc làm – không chép số từ trí nhớ
- Không ghi giá trị bí mật vào bất kỳ tệp nào trong kho, kể cả ví dụ; `check:secrets` không cho ngoại lệ
- Không chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080)
- Commit sau mỗi việc hoặc nhóm việc logic; dừng ở mỗi Checkpoint để kiểm chứng độc lập
