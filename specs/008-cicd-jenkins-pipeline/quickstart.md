# Quickstart – kiểm chứng 008 (Quy trình tích hợp và triển khai tự động – Jenkins)

Chạy trong worktree `.claude/worktrees/008-cicd-jenkins-pipeline` (không chạy docker compose ở checkout khác cùng
lúc – trùng cổng 3000/3001/8080). Lệnh trên máy cá nhân viết cho PowerShell. Chi tiết hợp đồng không lặp lại ở đây:
[quality-gates](./contracts/quality-gates.md) · [deploy-pipeline](./contracts/deploy-pipeline.md) ·
[jenkins-platform](./contracts/jenkins-platform.md) · [environment-inputs](./contracts/environment-inputs.md) ·
[data-model](./data-model.md).

Các phần được xếp theo điều kiện cần có, để kiểm chứng dần:

| Phần | Cần | Chứng minh |
|---|---|---|
| A | chỉ máy cá nhân + Docker | US1 (phần cổng), SC-002, SC-012 |
| B | máy Jenkins + kho GitHub | US1 (chặn hợp nhất), US4, SC-001, SC-003, SC-010, SC-014 |
| C | môi trường `staging` của 007 | US2, SC-005, SC-006, SC-007 |
| D | môi trường `production` của 007 | US3, SC-004, SC-009, SC-011 |

## A. Trên máy cá nhân

### A0. Chuẩn bị

```powershell
pnpm install
Copy-Item apps/server/.env.example apps/server/.env   # nếu chưa có
pnpm db:up; pnpm db:setup
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
pnpm exec playwright install chromium                 # một lần
```

### A1. Cổng chất lượng đầy đủ, hai chế độ

```powershell
pnpm verify                                   # chế độ máy cá nhân
pnpm verify --ci --report verify-report.json  # đúng lệnh Jenkins chạy
```

Mong đợi: mọi bước ĐẠT; `check:release-source` và (khi chưa có môi trường) `db:compat` hiện `· không áp dụng` kèm
lý do; `verify-report.json` đúng lược đồ `GateResult`, `passed: true`.

Phép thử FR-008 – bỏ qua là không đạt trên CI:

```powershell
$env:TEST_DATABASE_ADMIN_URL = $null
pnpm verify --ci --only test:db      # → KHÔNG ĐẠT (mã thoát 1), không phải "bỏ qua"
pnpm verify --only test:db           # → bỏ qua có thông báo (chế độ máy cá nhân)
```

### A2. Bộ năm vi phạm cài sẵn (SC-002)

Mỗi vi phạm làm trên một nhánh nháp tách từ `dev`, chạy đúng cổng tương ứng, rồi bỏ nhánh. Mỗi lần phải KHÔNG ĐẠT
và thông báo nêu đúng nguyên nhân + lệnh chạy lại.

| # | Cài vi phạm | Lệnh | Thông báo phải nêu |
|---|---|---|---|
| a | module `context` import tệp trong `modules/account/internal/` | `pnpm verify --ci --only check:boundaries` | module vi phạm, tệp, quy tắc |
| b | migration tạo bảng có `account_id` nhưng không bật RLS | `pnpm verify --ci --only test:db` | tên bảng (từ `db:check`) |
| c | bảng khách hàng mới đúng quy ước nhưng không thêm fixture truy cập chéo | `pnpm verify --ci --only test:db` | tên bảng chưa được phủ; số đã phủ / tổng số |
| d | migration `DROP COLUMN` một cột đang dùng; và một migration sửa nội dung tệp migration cũ | `pnpm verify --ci --only db:lint-migrations,db:immutable` | tệp, câu lệnh, lý do, cách chia bước thay thế |
| e | một chuỗi giống khóa truy cập trong `ops/ci/Jenkinsfile.ci` | `pnpm verify --ci --only check:secrets` | tệp và dòng (không in giá trị) |

Đối chứng: nhánh sạch → `pnpm verify --ci` ĐẠT.

### A3. Các cổng mới, từng cái một

```powershell
pnpm verify --only check:image        # dựng ảnh; migrate → api → worker đều báo đúng APP_VERSION
pnpm verify --only check:pipeline     # phiên bản cố định, lược đồ env, helm lint cho cả hai bộ tham số
pnpm verify --only db:compat          # mặc định so với origin/dev
```

Phép thử `db:compat` bắt được điều kiểm tra tĩnh cho qua: thêm migration bỏ một cột có khai báo `-- breaking-ok:`
trong khi mã ở `origin/dev` còn đọc cột đó → `db:lint-migrations` ĐẠT, `db:compat` KHÔNG ĐẠT (FR-020).

Phép thử `check:release-source` (không cần Jenkins):

```powershell
$env:GATE_TARGET_BRANCH = 'master'
$env:GATE_SOURCE_BRANCH = 'feature/x';  pnpm check:release-source   # → từ chối: chỉ nhận dev hoặc hotfix/*
$env:GATE_SOURCE_BRANCH = 'dev'; $env:STAGING_DEPLOYED_SHA = (git rev-parse HEAD~1)
pnpm check:release-source                                           # → từ chối: commit chưa triển khai lên test
```

### A4. Ngoại lệ vượt cổng (FR-009)

Trên nhánh có lỗi `lint`: thêm tệp `ops/ci/exceptions/<hôm nay>-lint.yml` hợp lệ → `pnpm verify --ci` ĐẠT, bảng tổng
kết hiện `! ngoại lệ`. Đổi `gate` thành `test:db` → `check:pipeline` KHÔNG ĐẠT (cổng cấm ngoại lệ). Đặt `expiresAt`
trong quá khứ → ngoại lệ bị bỏ qua, `lint` KHÔNG ĐẠT.

### A5. Mã ứng dụng của kiểm tra khói

```powershell
pnpm --filter @app/server test -- test/ops/smoke.e2e.spec.ts   # sai/thiếu mã → 404; thiếu SMOKE_TOKEN → 404
pnpm test:queue -- smoke-ping unknown-job-type                 # cùng giao dịch; chạy lại hai lần cùng kết quả;
                                                               # loại việc lạ được trả lại hàng chờ, không chôn
```

## B. Trên Jenkins + GitHub (chưa cần môi trường)

Điều kiện: máy Jenkins dựng theo `docs/ci-cd/rebuild-jenkins.md`; hai GitHub App và ruleset đã áp
(`ops/ci/github/apply-rulesets.sh`); hai tệp `ops/deploy/env/*.yaml` còn `provisioned: false`.

| # | Thao tác | Mong đợi | Truy vết |
|---|---|---|---|
| B1 | Mở pull request sạch vào `dev` | `ci/gates` + từng `gate/<bước>` hiện trên pull request trong ≤ 15 phút; nút hợp nhất mở khi `ci/gates` đạt (kho có từ hai thành viên: thêm 1 người duyệt khác tác giả – FR-004) | US1-1, SC-003 |
| B2 | Đẩy lại 5 nhánh vi phạm của A2 thành 5 pull request | cả 5 bị khóa hợp nhất; mỗi `gate/<bước>` hiện tên cổng, dòng lỗi đầu, đường dẫn nhật ký, lệnh chạy lại | US1-2…6, SC-002 |
| B3 | `git push origin dev` trực tiếp; và hợp nhất khi `ci/gates` đang chạy | cả hai bị GitHub từ chối | US1-7, SC-001 |
| B4 | Pull request sửa `ops/ci/Jenkinsfile.ci` để `echo` biến môi trường và gọi `withCredentials` | lần chạy vẫn dùng `Jenkinsfile.ci` của `dev`; nhật ký không có thông tin nào | US4-1 |
| B5 | Pull request thêm kịch bản `pretest` in `env`, thử `docker push` vào kho ảnh và `curl` điểm quản trị cụm | không có biến thông tin triển khai; hai kết nối bị tường lửa chặn | US4-1, FR-038 |
| B6 | Trong job `deploy/staging/deploy` (bản thử của SA) gọi thông tin xác thực của `deploy/production/` | Jenkins báo không tìm thấy thông tin xác thực; làm ngược lại cũng vậy | US4-2, SC-010 |
| B7 | Tài khoản nhóm `developers` bấm chạy `deploy/production/deploy` và `redeploy` | bị từ chối; Audit Trail có dòng ghi nhận | US4-4 |
| B8 | Gửi `POST /github-webhook/` không chữ ký từ ngoài; mở `/` từ địa chỉ ngoài danh sách | sự kiện bị từ chối; giao diện không truy cập được | FR-041 |
| B9 | Hợp nhất B1 vào `dev` | `deploy/staging/deploy` tự chạy trong ≤ 2 phút: cổng đạt, ảnh dựng được, kết thúc "chưa có môi trường đích" (không đỏ) + tin Telegram `ℹ️` | US2-1, ca biên |
| B10 | Tắt webhook trong GitHub rồi hợp nhất một pull request | job vẫn tự chạy trong ≤ 5 phút nhờ thăm dò | ca biên |
| B11 | Xuất nhật ký 20 lần chạy gần nhất, `node tooling/scan-secrets.mjs <thư mục>` | 0 phát hiện | US4-3, SC-010 |
| B12 | Diễn tập dựng lại: hủy máy ảo, `terraform apply`, nhập lại bí mật theo tài liệu | Jenkins chạy lại đủ job trong ≤ 4 giờ; lịch sử triển khai vẫn tra được trên GitHub | SC-014 |

## C. Môi trường test (`staging`)

Điều kiện: `staging` đáp ứng `contracts/environment-inputs.md`; `ops/deploy/env/staging.yaml` đặt `provisioned: true`;
thông tin xác thực đã nhập ở thư mục `deploy/staging/`.

| # | Thao tác | Mong đợi | Truy vết |
|---|---|---|---|
| C1 | Hợp nhất vào `dev` một thay đổi đổi một dòng chữ trên web + một migration thêm cột | không thao tác tay; ≤ 25 phút test hiện thay đổi; `GET {api}/healthz` trả `version` = SHA; tin Telegram `✅`; trang Environments của GitHub hiện bản đang chạy | US2-1…5, SC-003, SC-005, FR-045 |
| C2 | Chạy tay kiểm tra khói: `node ops/deploy/smoke/smoke.mjs --env staging --expect-version <sha>` | 4 mục ĐẠT; `apiVersion` = `workerVersion` = SHA | FR-032 |
| C3 | Trong lúc C1 đang `rollout`: chạy vòng lặp gọi `GET {api}/readyz` liên tục và tạo 50 việc thử | 0 yêu cầu lỗi; 50 việc xử lý đúng một lần | US2-4, SC-006 |
| C4 | Hợp nhất hai pull request cách nhau < 1 phút | hai lần triển khai chạy lần lượt (hoặc lần chờ gộp về commit mới nhất); môi trường kết thúc ở commit mới nhất | US2-7, FR-035 |
| C5 | Hợp nhất một bản cố ý làm `worker` không khởi động được (qua ngoại lệ ở `check:image`, có SA duyệt) | Helm tự quay về trong ≤ 10 phút; `api` vẫn bản cũ; CSDL giữ nguyên; tin `⚠️ ĐÃ QUAY VỀ BẢN TRƯỚC`; `DeploymentRecord.rolledBack = true` | US3-4 (diễn tập trên test), SC-007 |
| C6 | Hợp nhất một migration cố ý lỗi khi chạy (qua được kiểm tra tĩnh) | dừng ở `migrate`; `api`/`worker` chưa đổi; nhật ký nêu tệp lỗi; chạy lại sau khi sửa thì tiếp tục được | US3-5, ca biên |
| C7 | Bấm chạy lại lần triển khai C1 đã xong | mọi bước ĐẠT, không tạo thay đổi: ảnh dùng lại, Job migration bỏ qua, Helm không đổi | FR-037 |
| C8 | `deploy/staging/redeploy` với `VERSION` = bản trước, có `REASON` | dùng lại digest cũ, không dựng ảnh, không chạy migration; `kind = "redeploy"` | US3-6, FR-034 |
| C9 | Sau khi triển khai bản mới: mở lại một tệp `assets/…` của bản trước | 200 trong ít nhất 7 ngày | FR-031 |
| C10 | Đặt mã bot Telegram sai rồi triển khai | triển khai vẫn thành công; `notifyErrors` có ghi nhận | FR-044a |

## D. Môi trường release (`production`)

Điều kiện: như C cho `production`; nhánh `master` đã tạo và có ruleset; tài khoản kiểm tra nội bộ đã tạo.

| # | Thao tác | Mong đợi | Truy vết |
|---|---|---|---|
| D1 | Mở pull request `dev` → `master` khi đầu `dev` chưa triển khai xong lên test | `gate/check:release-source` KHÔNG ĐẠT, nêu commit; sau khi test xanh, `ci/gates` được chạy lại và ĐẠT | US3-2, FR-005 |
| D2 | Tài khoản không có vai `release-manager` thử hợp nhất vào `master`; khi kho có từ hai thành viên: tác giả tự duyệt / chưa ai duyệt | không hợp nhất được | US3-1 |
| D3 | Hợp nhất D1 (merge commit) | release tự triển khai, không chờ ai bấm, ≤ 30 phút; cùng `Jenkinsfile.deploy`; tin `✅ production` | US3-3, SC-004 |
| D4 | Mở pull request từ `feature/x` vào `master` | KHÔNG ĐẠT: "master chỉ nhận từ dev hoặc hotfix/*" | US3-10 |
| D5 | Tách `hotfix/demo` từ `master`, sửa nhỏ, mở pull request vào `master`, duyệt, hợp nhất | cổng đủ (gồm `db:compat` với bản đang chạy ở release), không đòi "đã chạy trên test"; `kind = "hotfix"`; ≤ 10 phút sau khi triển khai xong có pull request `backmerge/<sha12>` → `dev` + tin Telegram | US3-8, US3-9, SC-009 |
| D6 | Khi backmerge của D5 chưa hợp nhất, mở pull request `dev` → `master` | KHÔNG ĐẠT: "Bản sửa nóng … chưa về dev" | FR-005b |
| D7 | Nhánh `hotfix/*` có lẫn một commit của `dev` | KHÔNG ĐẠT: "Nhánh hotfix mang commit của dev" | FR-005a |
| D8 | Ảnh có lỗ hổng mức nghiêm trọng đã có bản vá (hạ phiên bản một gói trên nhánh thử) | test: cảnh báo trong tin; release: dừng ở bước `image`, môi trường giữ nguyên | FR-026 |
| D9 | Chọn ngẫu nhiên một lần triển khai release, trả lời: ai hợp nhất, ai duyệt, commit, digest, migration, kết quả | lấy được từ GitHub Deployments trong ≤ 5 phút | US3-7, SC-011 |
| D10 | Sau một lần kiểm tra khói ở release: soát dữ liệu | chỉ có dòng mới trong `infra.smoke_pings` và phiên của tài khoản kiểm tra nội bộ; không có lời gọi ra nền tảng / AI / email | FR-032 |

## E. Tài liệu (FR-046, SC-013)

Một thành viên chưa làm 008, chỉ theo `docs/ci-cd/branching-and-release.md` và `docs/ci-cd/gates.md`, đưa một thay
đổi nhỏ từ máy mình lên test trong ngày đầu, không ai làm hộ bước nào; ghi thời gian và câu hỏi phát sinh vào mục
"Lịch sử diễn tập" của tài liệu. Diễn tập `docs/ci-cd/emergency-deploy.md` một lần trên test với Jenkins tắt.

## Kết quả kiểm chứng

### Phần A (máy cá nhân, 2026-11-14)

| Mục | Kết quả |
| --- | --- |
| A1 `pnpm verify --ci --report` có CSDL | ĐẠT 15/15 bước (`check:release-source` và `db:compat` không áp dụng); thời gian 639 s |
| A1 phép thử FR-008 | không có CSDL: `--ci` KHÔNG ĐẠT (mã 1); chế độ máy cá nhân: bỏ qua có thông báo |
| A2 a – import `internal` của module khác | KHÔNG ĐẠT đúng nguyên nhân (`no-internal-cross-module`, nêu tệp) |
| A2 b – bảng có `account_id` không bật RLS | `test:db` KHÔNG ĐẠT, nêu `a-rls-missing:context.draft_no_rls` |
| A2 c – bảng đúng quy ước, thiếu fixture truy cập chéo | `test:db` KHÔNG ĐẠT, nêu tên bảng; cổng in "đã phủ 20 / tổng 21 bảng" |
| A2 d – `DROP COLUMN` và sửa migration cũ | `db:lint-migrations` bắt `drop-column` (kèm cách chia bước); `db:immutable` bắt tệp 0012 bị sửa |
| A2 e – chuỗi giống mã GitHub trong `Jenkinsfile.ci` | `check:secrets` KHÔNG ĐẠT, nêu tệp và dòng, không in giá trị |
| A2 nhánh sạch đối chứng | ĐẠT (chính lần chạy A1) → **5/5 vi phạm bị chặn, 0 báo sai** |
| A3 `check:release-source` | nguồn `feature/x` → từ chối; commit chưa lên test → từ chối |
| A3 `db:compat` bắt `-- breaking-ok:` | `db:lint-migrations` ĐẠT nhưng `db:compat` KHÔNG ĐẠT (FR-020) |
| A4 ngoại lệ | có tệp hợp lệ → `! ngoại lệ` và ĐẠT; cổng `test:db` → `check:pipeline` từ chối; hết hạn → `lint` KHÔNG ĐẠT |

Lỗi tìm ra khi chạy và đã sửa: `db:lint-migrations` chạy từ `apps/server` truyền sai đường dẫn cho git nên không thấy
migration mới và báo đạt oan. Nay dùng `git -C <gốc kho>`.

Ghi chú: `db:compat` đọc nhánh gốc từ `COMPAT_BASE_SHA` hoặc `origin/$GATE_TARGET_BRANCH`, còn `db:lint-migrations` và
`db:immutable` đọc `MIGRATION_BASE_REF`; Jenkins phải đặt cả hai (việc của `Jenkinsfile.ci`, T056).
Năm nhánh nháp (cục bộ, không đẩy) dùng lại cho T062: `draft/008-a-boundary`, `-b-no-rls`, `-c-no-fixture`,
`-d-migration`, `-e-secret` (và `-g-compat`).
