# Research: Quy trình tích hợp và triển khai tự động (Jenkins)

**Feature**: `008-cicd-jenkins-pipeline` · **Date**: 2026-11-13 · **Spec**: [spec.md](./spec.md)

Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã loại**. Phiên bản chính xác của công cụ (Jenkins LTS, phần
mở rộng, Helm, Trivy, kubectl) được cố định lúc implement trong tệp khóa tương ứng (R19) – kế hoạch này không
ghi số phiên bản chưa kiểm chứng.

Hiện trạng đã khảo sát trong kho mã (đầu vào của các quyết định):

- `tooling/verify.mjs` chạy tuần tự 12 bước; bước cần CSDL **được bỏ qua và tính là đạt** khi thiếu
  `TEST_DATABASE_ADMIN_URL` (trái FR-008 nếu để nguyên trên Jenkins).
- `Dockerfile` đã là một ảnh cho `api` / `worker` / `node dist/db/migrate.js`, chạy bằng người dùng `node`,
  ảnh nền cố định theo digest; chưa nhận `APP_VERSION` lúc dựng.
- `db:lint-migrations` có 6 luật tĩnh + chú thích `-- breaking-ok:`; nhánh gốc mặc định là `main` (kho mã không có
  nhánh này).
- `cross-tenant-coverage.db.spec.ts` lấy danh sách bảng từ **sổ đăng ký trong mã** (`tableRegistry`), chưa lấy từ
  cấu trúc CSDL thật; `db:check` đã đối chiếu catalog ↔ sổ đăng ký (luật j).
- `/healthz` của `api` và cổng sức khỏe của `worker` đã trả `version` = `APP_VERSION`.
- Tính năng `007` mới có đặc tả, **chưa có kế hoạch và chưa có mã Terraform**; chưa có môi trường nào tồn tại.

---

## R1. Hình thái Jenkins: một máy ảo, bộ điều khiển không chạy việc, hai tác nhân tách người dùng hệ điều hành

**Quyết định**: Một máy ảo (Ubuntu LTS) trên đám mây trong nước. Bộ điều khiển Jenkins chạy bằng container (ảnh
tự dựng từ ảnh LTS chính thức + `plugins.txt`), **0 bộ thực thi**. Hai tác nhân là hai dịch vụ systemd chạy dưới
hai người dùng Linux khác nhau, mỗi người dùng có **Docker rootless riêng**:

| Tác nhân | Người dùng | Nhãn | Chạy gì | Có gì |
|---|---|---|---|---|
| Kiểm tra | `ci-agent` | `ci` | mã của pull request (chưa review) | không có thông tin triển khai nào |
| Triển khai | `deploy-agent` | `deploy` | mã đã hợp nhất trên `dev` / `master` | thông tin triển khai được cấp theo từng lần chạy |

`ci-agent` không đọc được thư mục của Jenkins lẫn của `deploy-agent` (quyền tệp 0700). Tường lửa của máy
(nftables, lọc theo `skuid`) chặn `ci-agent` đi tới điểm quản trị của hai cụm, kho ảnh (ghi) và nơi phục vụ giao
diện tĩnh.

**Lý do**: FR-038/FR-041/FR-042 và US4 yêu cầu mã chưa review không chạm được thông tin triển khai. Cổng chất
lượng cần Docker (dựng ảnh, PostgreSQL tạm, Chromium); đưa socket Docker dùng chung cho mã của pull request là trao
quyền quản trị máy. Docker rootless theo từng người dùng tách được hai phía ngay trên một máy, không cần container
đặc quyền và không thêm máy thứ hai (Clarifications: "một máy ảo riêng").

**Đã loại**: (a) Jenkins trong cụm Kubernetes của test – trái Clarifications, mã chưa review chạy chung cụm với môi
trường; (b) hai máy ảo (kiểm tra / triển khai) – cô lập tốt hơn nhưng gấp đôi chi phí và công vận hành, để làm
điều kiện xem xét lại trong ADR-11; (c) Docker-in-Docker đặc quyền – thoát container được; (d) tác nhân dùng chung
socket Docker của máy.

## R2. Cấu hình Jenkins bằng mã

**Quyết định**: Toàn bộ cấu hình trong `ops/ci/jenkins/`: `Dockerfile` + `plugins.txt` (cố định phiên bản từng
phần mở rộng), `casc/*.yaml` (Configuration as Code: bảo mật, thư mục, thông tin xác thực **tham chiếu** biến môi
trường/tệp bí mật, tác nhân), `jobs/*.groovy` (Job DSL sinh các job). Giao diện Jenkins không dùng để cấu hình;
JCasC nạp lại khi khởi động. Máy ảo dựng bằng Terraform (`infra/ci/`) + `cloud-init` chạy `ops/ci/vm/bootstrap.sh`.

**Lý do**: FR-001 (định nghĩa nằm trong kho mã, review như mã), SC-014 (dựng lại ≤ 4 giờ), FR-042.

**Đã loại**: cấu hình tay rồi sao lưu `JENKINS_HOME` (không review được, trôi cấu hình); Ansible (thêm công cụ cho
một máy – `cloud-init` + một tập lệnh là đủ).

## R3. Ba nhóm job, thông tin xác thực gắn theo thư mục

**Quyết định**:

```text
ci/                      (thông tin: GitHub App "ci" – đọc mã, ghi kết quả kiểm tra)
└── gates                Multibranch: chỉ pull request nhắm dev / master; tác nhân `ci`
deploy/                  (thông tin: GitHub App "deploy", bot Telegram)
├── staging/             (thông tin của test: kho ảnh, cụm, kho tệp tĩnh, mã kiểm tra khói)
│   ├── deploy           Pipeline: chỉ nhánh dev; tác nhân `deploy`
│   └── redeploy         Pipeline có tham số (FR-034)
└── production/          (thông tin của release – cùng mã định danh, khác giá trị)
    ├── deploy           Pipeline: chỉ nhánh master
    └── redeploy
maintenance/             dọn ảnh, dọn tệp tĩnh cũ, đối chiếu luật bảo vệ nhánh (hẹn giờ)
```

Thông tin xác thực đặt ở **phạm vi thư mục**; job ở `ci/` và `deploy/staging/` không tra được thông tin của
`deploy/production/` (và ngược lại). Hai thư mục môi trường dùng **cùng mã định danh** thông tin
(`registry`, `kubeconfig`, `static-site`, `smoke`) nên một `Jenkinsfile.deploy` dùng cho cả hai (FR-036).

**Lý do**: thông tin xác thực theo thư mục là cơ chế chuẩn của Jenkins để tách quyền; phép thử US4-2 ("quy trình
test đòi dùng thông tin release → bị từ chối") trở thành hành vi mặc định chứ không dựa vào kỷ luật viết mã.

**Đã loại**: một Multibranch duy nhất với `when { branch }` và thông tin toàn cục – pull request sửa `Jenkinsfile`
là lấy được mọi thông tin.

## R4. `Jenkinsfile` của chặng kiểm tra lấy từ nhánh đã bảo vệ, không lấy từ pull request

**Quyết định**: Job `ci/gates` nạp `ops/ci/Jenkinsfile.ci` từ nhánh `dev` (đã review), còn thư mục làm việc là kết
quả hợp nhất dự kiến của pull request. `Jenkinsfile.ci` không `load` tệp Groovy nào từ thư mục làm việc; nó chỉ gọi
lệnh `pnpm …` bên trong container công cụ. Ứng viên hiện thực: phần mở rộng *Remote Jenkinsfile Provider*
(`remote-file`); dự phòng: *Pipeline Multibranch Defaults* (tệp do JCasC quản lý). Chọn và cố định lúc implement
sau khi thử phép thử US4-1.

Thay đổi `Jenkinsfile.ci` có hiệu lực sau khi hợp nhất vào `dev`. Để thử trước, SA chạy job tay `ci/sandbox` (báo
kết quả dưới tên kiểm tra khác, không phải tên bắt buộc).

**Lý do**: GitHub App "ci" có quyền ghi kết quả kiểm tra; nếu pull request sửa được định nghĩa quy trình thì nó tự
ghi được `ci/gates = đạt` cho chính mình (vượt FR-009) hoặc in thông tin ra ngoài (US4-1). Mã của pull request vẫn
chạy (kịch bản `package.json`, kiểm thử) nhưng ở phía không có thông tin nào được cấp.

**Đã loại**: tin `Jenkinsfile` của pull request vì "kho riêng tư, đội nhỏ" – đúng với kẻ ngoài, sai với phép thử
độc lập của US4 và với lỗi vô ý.

## R5. Kết nối GitHub: hai GitHub App, webhook có chữ ký, quét định kỳ dự phòng

**Quyết định**:

- **App "ci"**: đọc nội dung + pull request, ghi Checks. **App "deploy"**: đọc/ghi nội dung (tạo nhánh đưa bản sửa
  nóng về `dev`), ghi pull request, ghi Deployments. Khóa riêng của mỗi App nằm ở thư mục tương ứng (R3).
- Webhook của GitHub → `https://<ci-host>/github-webhook/`, có bí mật dùng chung; Jenkins từ chối sự kiện sai
  chữ ký (FR-041).
- Dự phòng khi mất webhook: `ci/gates` quét kho mỗi 10 phút; hai job `deploy` thăm dò nhánh mỗi 5 phút.
- Kết quả từng cổng báo bằng Checks API (`publishChecks`); một kiểm tra tổng **`ci/gates`** là kiểm tra bắt buộc
  duy nhất trong luật bảo vệ nhánh.

**Lý do**: GitHub App cho hạn mức gọi API cao hơn mã truy cập cá nhân, quyền hẹp, không gắn với một người; Checks
API hiển thị từng cổng kèm dòng lỗi và lệnh chạy lại ngay trên pull request (FR-002, FR-010). Một tên kiểm tra bắt
buộc cố định giúp thêm cổng mới mà không phải sửa luật bảo vệ nhánh.

**Đã loại**: mã truy cập cá nhân; trạng thái commit kiểu cũ (không có phần mô tả dài); mỗi cổng là một kiểm tra bắt
buộc riêng (quên thêm vào luật là cổng mới không chặn được gì).

## R6. Lối vào Jenkins từ internet

**Quyết định**: nginx trên máy ảo kết thúc TLS. **Chỉ** đường dẫn `/github-webhook/` mở cho internet; mọi đường
dẫn khác chỉ nhận từ danh sách địa chỉ được phép (tham số Terraform) – ngoài danh sách thì dùng đường hầm SSH
bằng khóa cá nhân. Đăng nhập bằng GitHub OAuth (từng cá nhân), phân quyền ma trận theo thư mục: nhóm `developers`
đọc mọi nơi và chạy lại ở `ci/`; nhóm `release-managers` (SA, PO) mới được chạy tay/chạy lại/`redeploy` ở
`deploy/production/`. Phần mở rộng Audit Trail ghi mọi thao tác quản trị và lần bị từ chối (US4-4).

**Lý do**: FR-041. Không thêm VPN (thêm một dịch vụ phải vận hành – nguyên tắc IX).

**Đã loại**: mở toàn bộ giao diện ra internet sau màn đăng nhập (bề mặt tấn công của Jenkins lớn); WireGuard.

## R7. Luật bảo vệ nhánh và luồng nhánh, quản lý bằng mã

**Quyết định**: Hai bộ luật (ruleset) của GitHub lưu ở `ops/ci/github/rulesets/{dev,master}.json`, áp bằng
`ops/ci/github/apply-rulesets.sh` (`gh api`, chạy lại được); job `maintenance/ruleset-drift` hằng ngày so luật đang
áp với tệp trong kho và báo Telegram nếu lệch.

| Luật | `dev` | `master` |
|---|---|---|
| Cấm đẩy thẳng, cấm xóa, cấm ghi đè lịch sử | có | có |
| Kiểm tra bắt buộc `ci/gates`, nhánh phải cập nhật so với đích | có | có |
| Số người duyệt khác tác giả – kho có **từ hai** thành viên | 1 | 1, duyệt cũ bị hủy khi có commit mới |
| Số người duyệt – kho chỉ có **một** thành viên (hiện tại) | 0 | 0 |
| Duyệt của chủ mã (`CODEOWNERS`) cho `ops/ci/**`, `ops/deploy/**`, `infra/ci/**` | có khi ≥ 2 thành viên | có khi ≥ 2 thành viên |
| Ai được hợp nhất | thành viên của kho | **chỉ vai `release-manager`** (hiện là chủ dự án) |
| Cách hợp nhất cho phép | tùy đội | **chỉ merge commit** |
| Người được vượt luật | không ai | không ai |

"Nhánh phải cập nhật so với đích" bảo đảm cây mã đã kiểm tra chính là cây mã sau hợp nhất (FR-002). `dev` cũng
yêu cầu một người duyệt vì hiến pháp ghi "mọi thay đổi MUST qua review" (FR-004 sau Clarifications 2026-11-13).

**Chế độ một thành viên** (Clarifications 2026-11-13, sau `/speckit-analyze`): GitHub không cho tác giả tự duyệt,
nên khi kho chỉ có một người thì yêu cầu người duyệt và duyệt của chủ mã tạm tắt; bước duyệt của con người là việc
người có vai `release-manager` bấm hợp nhất. `check:pipeline` so `ops/ci/team.json` với hai tệp ruleset: có từ hai
thành viên mà ruleset chưa yêu cầu người duyệt → không đạt, để chế độ này không kéo dài quá thực tế. Cơ chế giới
hạn người hợp nhất vào `master` phụ thuộc loại tài khoản GitHub (cá nhân / tổ chức) – chốt lúc implement.

**Cơ chế "chỉ `release-manager` hợp nhất vào `master`"** (chốt lúc implement, T058): ruleset của GitHub không giới hạn
*ai bấm hợp nhất*. Kho thuộc **tài khoản cá nhân** chỉ có chủ kho và cộng tác viên có quyền ghi, nên:
(1) khi chỉ có một thành viên, người đó là `release-manager` và là người duy nhất hợp nhất được; (2) từ hai thành
viên, `CODEOWNERS` (`*` thuộc `release-manager`) kết hợp ruleset yêu cầu duyệt của chủ mã khiến chỉ duyệt của
`release-manager` mới mở được nút hợp nhất vào `master`; cộng tác viên khác chỉ được cấp quyền Write cho `dev`
(không cấp Maintain/Admin). Chuyển kho sang **tổ chức** sẽ cho cơ chế chặt hơn (giới hạn người hợp nhất theo nhóm).
Ghi nhận ở `docs/ci-cd/branching-and-release.md` (T091).

**Điều kiện tiên quyết**: luật bảo vệ nhánh trên kho **riêng tư** cần gói GitHub trả phí (Team). Phải xác nhận
trước khi implement US1 – xem mục Rủi ro của plan.

**Đã loại**: Terraform provider của GitHub (thêm một trạng thái Terraform chỉ cho hai bộ luật); cấu hình tay.

## R8. Cổng "nguồn phát hành" (FR-005, FR-005a, FR-005b) – không cần lưu trạng thái riêng

**Quyết định**: Bước mới `check:release-source` (`tooling/check-release-source.mjs`), chỉ có hiệu lực khi đích là
`master`:

| Nguồn | Điều kiện | Cách kiểm |
|---|---|---|
| `dev` | mọi commit đã triển khai thành công lên test | lấy SHA của lần triển khai `staging` thành công gần nhất từ GitHub Deployments (R14) → `git merge-base --is-ancestor <đầu PR> <SHA đó>` |
| `dev` | không còn bản sửa nóng chưa về `dev` | `git rev-list --count --no-merges origin/master ^<đầu PR>` = 0 |
| `hotfix/*` | tách từ `master`, không mang commit của `dev` | `git rev-list <đầu PR> ^origin/master` không có commit nào là tổ tiên của `origin/dev` |
| khác | — | từ chối, nêu hai nguồn hợp lệ |

Sau khi triển khai release xong một bản sửa nóng, `Jenkinsfile.deploy` tạo nhánh `backmerge/<sha12>` từ đầu
`master` và mở pull request vào `dev` (App "deploy"); có xung đột thì pull request vẫn mở, gắn nhãn
`needs-manual-merge` và báo Telegram. Sau khi test triển khai thành công, quy trình chạy lại `ci/gates` cho pull
request `dev` → `master` đang mở (nếu có).

**Lý do**: Điều kiện thứ hai dựa vào luật "chỉ merge commit" trên `master` (R7): sau một lần phát hành thường,
thứ duy nhất `master` có mà `dev` chưa có là commit hợp nhất; mọi commit thường xuất hiện ở đó chính là bản sửa
nóng chưa về `dev`. Không cần bảng hay tệp trạng thái nào.

**Đã loại**: nhãn Git `deployed/staging/*` (phải cấp quyền đẩy nhãn, dễ lệch); GitHub không có luật gốc giới hạn
nhánh nguồn của pull request.

## R9. Cổng chất lượng = `pnpm verify`, thêm chế độ CI và báo cáo máy đọc được

**Quyết định**: Mở rộng `tooling/verify.mjs`, không viết kiểm tra nào trong Groovy:

- `--ci` (hoặc `CI=true`): bước bị bỏ qua **tính là không đạt** (FR-008).
- `--only <bước>[,<bước>]`: chạy đúng các bước nêu – vừa là lệnh "chạy lại cổng này trên máy cá nhân" (FR-010),
  vừa là thứ Jenkins gọi cho từng làn song song.
- `--report <tệp.json>`: ghi kết quả từng bước (tên, đạt/không đạt/ngoại lệ, dòng lỗi đầu, thời lượng, lệnh chạy
  lại) – `Jenkinsfile.ci` đọc tệp này để đăng Checks; lược đồ ở [contracts/quality-gates.md](./contracts/quality-gates.md).
- `--exceptions`: áp ngoại lệ FR-009 (R17).

Bước mới thêm vào danh sách mặc định: `check:release-source` (R8), `db:immutable` (R11), `db:compat` (R12),
`check:image` (R13), `check:pipeline` (R19).

Jenkins chạy các bước theo **ba làn song song** trên tác nhân `ci`, mỗi làn là một lệnh `pnpm verify --ci --only …`
trong cùng container công cụ (`ops/ci/toolchain/Dockerfile`: Node 24, pnpm theo `packageManager`, Chromium của
Playwright, git, docker CLI – ảnh nền cố định digest). PostgreSQL tạm là container cùng phiên bản chính với môi
trường, khởi động đầu lần chạy và hủy cuối lần chạy.

**Lý do**: FR-007/SC-012 – một nguồn sự thật cho danh sách cổng, máy cá nhân và Jenkins chạy cùng lệnh. Song song
để đạt SC-003 (≤ 15 phút); số làn điều chỉnh sau khi đo lúc implement.

**Đã loại**: mỗi cổng một `stage` viết tay trong `Jenkinsfile` (cổng mới dễ chỉ tồn tại ở Jenkins); chạy tuần tự
một lệnh `pnpm verify` (đơn giản hơn nhưng rủi ro vượt 15 phút khi bộ kiểm thử lớn dần).

## R10. Kiểm thử truy cập chéo: lấy danh sách từ cấu trúc CSDL, phủ cả đường vào ngoài bảng

**Quyết định**: Giữ khuôn `describeCrossTenant` + tệp fixture hiện có; bổ sung trong `test:db`:

1. **Bao phủ theo catalog (FR-014, SC-008)**: sau khi migrate CSDL tạm, truy vấn `pg_attribute` lấy mọi bảng có cột
   `account_id` trong các schema của tệp kê khai module; mỗi bảng phải có fixture hoặc mục miễn trừ có lý do. In
   ra số bảng đã phủ / tổng số ở mỗi lần chạy.
2. **Kiểm kê đường vào khác (FR-015)**: từ catalog lấy (a) mọi khung nhìn mà `support` hoặc `app` được `SELECT`,
   (b) mọi hàm `SECURITY DEFINER` mà `app` được `EXECUTE`, (c) `pgboss.job_common`. Mỗi mục phải nằm trong tệp
   `test/db/fixtures/access-path-inventory.ts` với một ca kiểm thử chứng minh vai trò `app` trong ngữ cảnh tài
   khoản A không lấy được dữ liệu của B, hoặc một lý do miễn trừ. Mục mới chưa kiểm kê → đỏ.
3. **Vai trò `app` (FR-016)**: đã có ở `ownership.db.spec.ts` (không `BYPASSRLS`, không sở hữu) – thêm khẳng định
   `app` không sở hữu bảng nào trong **mọi** schema không phải hệ thống.

**Lý do**: bao phủ theo sổ đăng ký trong mã bỏ sót bảng tạo bằng SQL tay; đặc tả yêu cầu "không dựa vào việc lập
trình viên nhớ". `db:check` đã chặn bảng ngoài sổ đăng ký – hai lớp bổ trợ nhau.

**Đã loại**: sinh ca kiểm thử hoàn toàn tự động không cần fixture (không biết cách tạo dòng hợp lệ cho bảng có
ràng buộc; fixture tường minh đã chứng minh được ở 006).

## R11. Migration bất biến (FR-019) và bổ sung luật tĩnh (FR-017)

**Quyết định**:

- `db:immutable` (`apps/server/src/db/check-immutable.ts`): so `drizzle/migrations/**` và `meta/_journal.json` giữa
  nhánh đích và HEAD – tệp đã có trên nhánh đích chỉ được **giữ nguyên**; nhật ký chỉ được nối thêm vào cuối.
  "Đã áp dụng lên môi trường" được hiểu là "đã có trên `dev` hoặc `master`", vì hợp nhất vào `dev` là triển khai
  ngay.
- `db:lint-migrations`: nhánh gốc lấy từ `MIGRATION_BASE_REF` do Jenkins đặt bằng `origin/<nhánh đích>`; mặc định
  đổi từ `main` sang `origin/dev`. Thêm luật: `ADD COLUMN … NOT NULL` không có `DEFAULT`; `ADD CONSTRAINT`
  (CHECK/FK/UNIQUE) trên bảng có sẵn mà không `NOT VALID` / không qua chỉ mục dựng sẵn; `CREATE INDEX` không
  `CONCURRENTLY` trên bảng có sẵn; `DROP TYPE` / bỏ giá trị enum. Mỗi vi phạm in thêm **cách chia bước thay thế**.
- Thao tác thu hẹp có chủ đích tiếp tục khai báo bằng `-- breaking-ok: <lý do>` (FR-020) và chỉ qua cổng khi
  `db:compat` (R12) đạt.

**Kết quả kiểm chứng thứ tự áp migration (T021, 2026-11-13)** – `apps/server/test/db/migration-order.db.spec.ts`,
chạy đúng `runMigrations` trên PostgreSQL thật với drizzle-orm 0.45.4:

| Tình huống | Quan sát |
|---|---|
| Đã áp A (`when` 1000), B (3000); thêm C (2000) vào **cuối** nhật ký rồi chạy lại | C **bị bỏ qua âm thầm**: không áp, không lỗi, không dòng nhật ký; về sau cũng không bao giờ được áp |
| Đã áp A, B; thêm D (4000) | D được áp |
| CSDL trống, nhật ký A, B, C | cả ba được áp theo thứ tự nhật ký |

Nguyên nhân: bộ chạy chỉ so `when` của từng mục với `created_at` lớn nhất trong `infra.schema_migrations`.
Hệ quả đã áp vào thiết kế:

1. **Sửa nóng không được kèm migration** – `check:release-source` chặn nhánh `hotfix/*` có tệp mới trong
   `apps/server/drizzle/migrations/`; edge case tương ứng trong spec.md đã sửa.
2. **Mốc `when` của migration mới phải lớn hơn mọi migration đã có ở nhánh đích** – thêm vào `db:immutable`
   (so với đầu nhánh gốc, không phải điểm rẽ nhánh). Ca thường gặp: hai nhánh tính năng cùng sinh migration,
   nhánh sinh trước lại hợp nhất sau. Cách sửa: `git merge origin/dev` rồi đặt lại `when` của mục mới trong
   `_journal.json` thành thời điểm hiện tại (tệp chưa áp ở đâu nên được phép sửa).
3. Khi nâng drizzle-orm mà ca kiểm thử trên đổi kết quả → xem lại hai luật này.

**Lý do**: tận dụng công cụ đã có từ 002; chỉ thêm đúng các trường hợp FR-017 liệt kê mà 6 luật hiện tại chưa bắt.

**Đã loại**: công cụ lint SQL bên ngoài (squawk…) – thêm phụ thuộc nhị phân trong khi bộ tách câu lệnh và cơ chế
chú thích đã có và đã có kiểm thử.

## R12. Kiểm tra động tương thích ngược (FR-018): chạy bản đang chạy ở môi trường đích trên cấu trúc mới

**Quyết định**: Bước `db:compat` (`tooling/db-compat.mjs`):

1. Xác định **bản gốc** = SHA đang chạy ở môi trường đích (pull request vào `dev` → test; vào `master` → release;
   chặng triển khai → chính môi trường đó). Jenkins lấy từ GitHub Deployments và đặt `COMPAT_BASE_SHA`; trên máy
   cá nhân mặc định là `origin/<nhánh đích>`.
2. Môi trường chưa từng triển khai → kết quả **đạt, ghi rõ "chưa có bản đang chạy"** (không phải bỏ qua).
   Không có migration mới so với bản gốc → đạt, ghi rõ "không có migration mới".
3. `git worktree add` bản gốc vào thư mục tạm, `pnpm install --frozen-lockfile`, build.
4. Tạo CSDL tạm, áp **toàn bộ migration của HEAD** bằng vai trò `owner`.
5. Trong thư mục bản gốc chạy `pnpm test:compat` trỏ vào CSDL đó: khởi động `api` và `worker` của bản gốc, chờ
   `/healthz` + `/readyz` đạt, chạy tập kiểm thử hành vi trên CSDL (`*.db.spec.ts` trừ nhóm kiểm cấu trúc) và một
   vòng tạo việc → xử lý việc.

`test:compat` là **hợp đồng mà mọi phiên bản từ 008 trở đi phải có**: nhận CSDL đã migrate sẵn
(`COMPAT_DATABASE_*_URL`), không tự migrate, không chứa kiểm thử khẳng định cấu trúc (số migration, quy ước bảng).

**Lý do**: kiểm tra tĩnh không biết mã cũ thật sự dùng cột nào; đây là phép thử trực tiếp của yêu cầu hiến pháp
"API/Worker cũ và mới chạy song song khi phát hành" và là điều kiện để quay về bản trước an toàn. Dựng bản gốc từ
mã nguồn thay vì kéo ảnh cũ từ kho ảnh để chặng kiểm tra **không cần quyền đọc kho ảnh** (FR-038). Chưa có môi
trường nào tồn tại nên không có phiên bản cũ nào thiếu `test:compat`.

**Đã loại**: kéo ảnh đang chạy từ kho ảnh (cần thông tin kho ảnh ở phía chưa review; ảnh không chứa bộ kiểm thử);
chỉ khởi động bản cũ rồi gọi `/readyz` (không chạm đường đọc/ghi thật).

## R13. Ảnh phát hành: một ảnh mỗi commit, triển khai theo digest

**Quyết định**:

- `Dockerfile` thêm `ARG APP_VERSION` → `ENV APP_VERSION` và nhãn OCI (`revision`, `created`, `source`).
  `APP_VERSION` = SHA đầy đủ của commit.
- Thẻ ảnh = SHA đầy đủ. Trước khi đẩy, quy trình hỏi kho ảnh: thẻ đã tồn tại → **dùng lại, không đẩy đè** (chạy
  lại an toàn – FR-037; không ghi đè – FR-023). Triển khai luôn tham chiếu **digest** (`repo@sha256:…`).
- Bước `check:image` (`tooling/check-image.mjs`) – chạy ở cả hai chặng: dựng ảnh; khẳng định không có `.env*`,
  không có mã web, không có `devDependencies`, người dùng chạy không phải root; chạy ảnh ở ba vai (`migrate` lên
  CSDL tạm → `api` → `worker`) và chờ điểm sức khỏe trả đúng `APP_VERSION`.
- Dựng bằng `docker buildx` trên tác nhân; mỗi môi trường đẩy vào kho ảnh riêng của mình (đầu ra của `007`).
- Quét lỗ hổng bằng **Trivy** chạy cục bộ trên tác nhân `deploy` (chỉ tải cơ sở dữ liệu lỗ hổng về, không gửi ảnh
  đi đâu): release chặn khi có lỗ hổng mức nghiêm trọng **đã có bản vá**; test chỉ cảnh báo trong thông báo. Tệp
  `.trivyignore` chỉ nhận mục có lý do và ngày hết hạn.
- Giữ ảnh (FR-025): job `maintenance/prune-images` hằng tuần gọi API kho ảnh, giữ ảnh của 10 lần triển khai release
  gần nhất **và** mọi ảnh dưới 90 ngày; danh sách "đã lên release" lấy từ GitHub Deployments.

**Lý do**: digest là bảo đảm kỹ thuật cho "không bị ghi đè", không phụ thuộc kho ảnh có tính năng khóa thẻ hay
không. Dựng lại ở `master` thay vì đưa ảnh của test lên: commit hợp nhất trên `master` khác commit trên `dev`
(Assumptions của đặc tả), và hai môi trường có kho ảnh riêng; bộ nhớ đệm lớp ảnh giữ thời gian dựng thấp.

**Đã loại**: đưa nguyên ảnh từ test lên release (tối ưu được đặc tả cho phép nhưng không bắt buộc – cần quyền đọc
chéo kho ảnh giữa hai môi trường, trái tinh thần FR-038); Kaniko/BuildKit độc lập (Docker rootless đã có sẵn cho
kiểm thử).

## R14. Lịch sử triển khai và "môi trường đang chạy bản nào": GitHub Deployments

**Quyết định**: Mỗi lần triển khai tạo một bản ghi GitHub Deployment (`environment` = `staging` / `production`,
`ref` = SHA) với `payload` là **bản ghi triển khai** (lược đồ ở [data-model.md](./data-model.md)): người hợp nhất,
người duyệt, digest ảnh, danh sách migration đã chạy, kết quả và thời lượng từng bước, có quay về không, có phải
sửa nóng / triển khai lại / dùng ngoại lệ không. Trạng thái: `in_progress` → `success` | `failure`
(mô tả "đã quay về bản trước" khi áp dụng). Jenkins giữ nhật ký chạy 400 ngày; đĩa máy ảo được chụp hằng ngày.

**Lý do**: FR-043 (12 tháng) phải sống sót khi dựng lại Jenkins (SC-014) – bản ghi không được chỉ nằm trên đĩa của
Jenkins. GitHub Deployments đồng thời cho FR-045 (trang Environments của kho mã hiển thị bản đang chạy và thời
điểm), và là nguồn dữ liệu cho R8, R12, R13 mà phía kiểm tra chỉ cần quyền **đọc**. Bản ghi chỉ chứa siêu dữ
liệu triển khai, không có dữ liệu khách hàng (đã nêu ở Assumptions về GitHub).

**Đã loại**: bảng trong CSDL của ứng dụng (Jenkins không được có đường mạng tới CSDL – FR-041); kho tệp riêng cho
bản ghi (thêm tài nguyên); chỉ dựa vào lịch sử của Jenkins.

## R15. Triển khai lên Kubernetes: Job migration tường minh + Helm nguyên tử

**Quyết định**: Một Helm chart `ops/deploy/chart/` (Deployment `api`, Deployment `worker`, Service, Ingress, PDB,
ConfigMap; **không chứa bí mật** – chỉ tham chiếu tên Secret do `007` đồng bộ từ kho bí mật). Trình tự của
`Jenkinsfile.deploy` cho một môi trường, dưới khóa `deploy-<env>`:

1. **Migration**: `kubectl apply` một Job tên `migrate-<sha12>` trong namespace `app-migrate` (cùng ảnh, lệnh
   `node dist/db/migrate.js`, gắn Secret `db-owner` – Secret này **không** tồn tại ở namespace `app`). Job đã tồn
   tại và thành công → bỏ qua. Chờ xong, lấy nhật ký → danh sách migration đã áp. Thất bại → dừng, ứng dụng chưa
   đổi.
2. **Ứng dụng**: `helm upgrade --install app … --set image.digest=<digest> --atomic --wait --timeout 8m`.
   `--atomic` làm `api` và `worker` cùng thành công hoặc cùng quay về (FR-029, FR-033, ca "api khỏe nhưng worker
   không khởi động được"). `HELM_DRIVER=configmap` để tài khoản triển khai **không cần quyền đọc Secret**.
3. **Giao diện web** (R16) → **kiểm tra khói** (R18). Không đạt → `helm rollback app <bản trước> --wait` + trả con
   trỏ giao diện về bản trước; ghi "đã quay về".

Thiết lập không gián đoạn trong chart (FR-030): `maxUnavailable: 0`, `maxSurge: 1`; `api` có `readinessProbe` →
`/readyz` và `preStop` chờ 5 giây; `worker` có `terminationGracePeriodSeconds: 40` (ứng dụng tự dừng trong 30 giây
– đã có từ 003), `readinessProbe` → cổng sức khỏe 3001; PDB `minAvailable: 1` cho mỗi Deployment.

Quyền của Jenkins trong cụm (FR-039): ServiceAccount `ci-deployer` với Role tối thiểu ở hai namespace
(`deployments`, `replicasets`, `pods`, `pods/log`, `configmaps`, `services`, `ingresses`, `poddisruptionbudgets`;
`jobs` ở `app-migrate`); **không có** `secrets`, `pods/exec`, `pods/portforward`.

**Lý do**: Helm cho đúng hai thứ khó tự viết: nâng cấp nguyên tử nhiều Deployment và lịch sử để quay về / triển
khai lại (FR-034). Job migration nằm ngoài chart để nhật ký và kết quả của nó thuộc về một bước riêng của quy
trình (FR-027 bước 3, US3-5) và để Secret `owner` tách namespace. Helm là công cụ dòng lệnh, không phải dịch vụ
chạy thêm.

**Rủi ro còn lại đã cân nhắc**: ai tạo được Job trong `app-migrate` thì về lý thuyết chạy được ảnh tùy ý có gắn
Secret `owner`. Chặn bằng: (a) thông tin triển khai chỉ cấp cho `Jenkinsfile.deploy` trên nhánh đã bảo vệ;
(b) yêu cầu gửi `007`: chính sách chấp nhận của cụm chỉ cho phép ảnh từ kho ảnh của chính môi trường
([contracts/environment-inputs.md](./contracts/environment-inputs.md)).

**Đã loại**: Helm hook `pre-upgrade` cho migration (nhật ký và lỗi bị giấu trong vòng đời hook; khó chạy lại riêng);
`kubectl set image` hai Deployment (không nguyên tử); Argo CD / Flux (thêm dịch vụ chạy trong cụm – nguyên tắc IX,
và đặc tả chốt Jenkins điều phối toàn bộ).

## R16. Đưa giao diện web lên: tệp có mã băm trước, `index.html` cuối, con trỏ theo bản phát hành

**Quyết định**: `ops/deploy/scripts/publish-web.mjs` (dùng `@aws-sdk/client-s3` đã có trong kho mã):

1. `pnpm --filter @app/web build` từ cùng commit, tham số môi trường lấy từ tệp tham số (R20).
2. Tải `assets/*` (tên có mã băm, `Cache-Control: public, max-age=31536000, immutable`) – không xóa tệp cũ.
3. Ghi `releases/<sha>/index.html` và `releases/<sha>/manifest.json` (danh sách tệp của bản này).
4. **Cuối cùng**, sau khi `api` mới đã khỏe: ghi `index.html` (`Cache-Control: no-cache`).

Quay về bản trước = chép `releases/<sha trước>/index.html` thành `index.html`. Job `maintenance/prune-web` hằng
ngày xóa tệp trong `assets/` không thuộc manifest của bản hiện hành hay của bản nào còn trong 7 ngày (FR-031).
Thông tin truy cập chỉ có quyền trên kho tệp tĩnh, không có quyền trên kho tệp media (FR-039).

**Lý do**: thứ tự này bảo đảm người đang mở trang cũ vẫn tải được tệp cũ, người mới chỉ thấy `index.html` mới khi
mọi tệp nó trỏ tới đã có. Con trỏ theo bản phát hành cho quay về tức thì mà không dựng lại.

**Đã loại**: `aws s3 sync --delete` (xóa tệp bản trước ngay); cài AWS CLI (thêm công cụ khi SDK đã có sẵn).

## R17. Ngoại lệ vượt cổng (FR-009) là tệp trong kho mã, được chủ mã duyệt

**Quyết định**: Một ngoại lệ là một tệp `ops/ci/exceptions/<YYYY-MM-DD>-<cổng>.yml` (`gate`, `reason`,
`approvedBy`, `expiresAt` ≤ 7 ngày, `commit` hoặc `pullRequest`). `CODEOWNERS` đặt thư mục này cho SA và PO; luật
bảo vệ nhánh yêu cầu duyệt của chủ mã (R7). `pnpm verify --ci` đọc ngoại lệ còn hạn: cổng không đạt có ngoại lệ →
báo **"VƯỢT CỔNG (ngoại lệ)"**, hiện trong bảng tổng kết, Checks, thông báo Telegram và bản ghi triển khai.

**Không cho ngoại lệ** với: `test:db` (truy cập chéo, RLS – nguyên tắc I), `check:secrets` và
`check:secrets:test-logs` (nguyên tắc VII), `db:immutable`, `check:release-source`. Các cổng này thuộc nguyên tắc
"không thương lượng" của hiến pháp hoặc bảo vệ chính quy trình.

**Lý do**: ngoại lệ nằm trong lịch sử Git (ai, khi nào, lý do, ai duyệt), có hiệu lực giống nhau ở cả hai chặng,
không cần quyền vượt luật trên GitHub hay tham số ẩn trong Jenkins. Hết hạn thì tự vô hiệu.

**Đã loại**: quyền "bypass" của GitHub cho quản trị kho (vượt được **mọi** cổng, kể cả cô lập tenant; chặng sau hợp
nhất vẫn đỏ); tham số `SKIP_GATE` trên job Jenkins (không qua review).

## R18. Kiểm tra khói trên môi trường thật

**Quyết định**: `ops/deploy/smoke/smoke.mjs` chạy từ tác nhân `deploy`, chỉ qua HTTPS công khai:

| Kiểm | Cách |
|---|---|
| `api` khỏe, đúng phiên bản | `GET /healthz`, `/readyz` → `version` = SHA mong đợi |
| Ghi–đọc CSDL bằng vai trò `app`; hàng chờ nhận và xử lý một việc thử; `worker` đúng phiên bản | `POST /ops/smoke` (mã kiểm tra khói trong tiêu đề) → API ghi một dòng `infra.smoke_pings`, tạo việc hệ thống `queue.smoke_ping` trong cùng giao dịch; Worker xử lý, ghi `worker_version`; `GET /ops/smoke/:id` trả kết quả |
| Đăng nhập được | đăng nhập bằng **tài khoản kiểm tra nội bộ dành riêng** qua điểm cuối đăng nhập thật, rồi đăng xuất |
| Giao diện mở được qua HTTPS | `GET /` trả `index.html` trỏ tới tệp của đúng bản phát hành; tải được tệp JS chính |

`infra.smoke_pings` là bảng dùng chung (không có dữ liệu khách hàng), dòng cũ hơn 7 ngày được việc dọn dẹp định kỳ
xóa. `POST /ops/smoke` khai báo `@Public` + kiểm mã bằng so sánh thời gian hằng, giới hạn tốc độ; mã sai → 404.
Kiểm tra khói không gọi nền tảng mạng xã hội, nhà cung cấp AI hay gửi email (FR-032).

**Lý do**: cổng sức khỏe của `worker` không mở ra ngoài cụm và tài khoản triển khai không có `pods/exec` (R15);
vòng tạo việc → xử lý việc vừa chứng minh hàng chờ hoạt động vừa lấy được phiên bản `worker` qua đúng đường mà ứng
dụng dùng thật. Đây là phần mã ứng dụng duy nhất mà tính năng này thêm (module `queue`, schema `infra`).

**Đã loại**: `kubectl port-forward` tới `worker` (phải cấp thêm quyền, không kiểm đường Ingress thật); Job kiểm
tra khói chạy trong cụm (không chứng minh được HTTPS từ bên ngoài).

## R19. Cố định phiên bản và kiểm tra chính định nghĩa quy trình

**Quyết định**: `ops/ci/versions.env` là nơi duy nhất ghi phiên bản + mã băm của Helm, kubectl, Trivy; ảnh
Jenkins, ảnh công cụ, ảnh PostgreSQL kiểm thử cố định theo digest; `plugins.txt` cố định từng phần mở rộng. Bước
`check:pipeline` (`tooling/check-pipeline.mjs`) trong `pnpm verify`: mọi `FROM`/`image:` có digest; `plugins.txt`
không có `latest`; `helm lint` + `helm template` cho cả hai bộ tham số (khi có `helm`); các tệp tham số môi trường
đúng lược đồ; hai tệp ruleset hợp lệ; `Jenkinsfile*` không chứa chuỗi giống bí mật (đã thuộc `check:secrets`).

**Lý do**: FR-042; định nghĩa quy trình cũng là mã phải qua cổng.

## R20. Tham số môi trường và ca "chưa có môi trường đích"

**Quyết định**: `ops/deploy/env/staging.yaml` và `production.yaml` chứa **tham số không bí mật** lấy từ danh sách
đầu ra FR-024 của `007` (địa chỉ kho ảnh, điểm quản trị cụm, tên miền `api` và web, tên kho tệp tĩnh + điểm cuối
S3, số bản chạy, mức chặn Trivy, tên các Secret) và cờ `provisioned: true|false`. `provisioned: false` → quy trình
vẫn chạy cổng chất lượng và `check:image`, rồi kết thúc với kết quả **"chưa có môi trường đích"** (không đỏ, có
thông báo) – đúng ca biên của đặc tả. Hai tệp cùng một lược đồ, được `check:pipeline` kiểm.

**Lý do**: FR-036 (khác biệt chỉ ở tham số); `007` chưa dựng môi trường nào nên US1 và phần dựng ảnh phải làm
được trước, độc lập.

## R21. Thông báo Telegram

**Quyết định**: `ops/ci/scripts/notify-telegram.mjs` gọi Bot API bằng `fetch` của Node; thử lại 3 lần giãn cách;
thất bại không làm hỏng lần triển khai (bọc `catchError`), lỗi gửi ghi vào bản ghi triển khai (FR-044a). Khuôn tin
cố định ở [contracts/deploy-pipeline.md](./contracts/deploy-pipeline.md): môi trường, kết quả, SHA rút gọn, tác giả,
bước hỏng, đường dẫn Jenkins. Release hỏng / đã quay về: nhắc tên người hợp nhất và nhóm trực theo
`ops/ci/team.json` (tên GitHub → tên Telegram). Không đưa nhật ký thô vào tin.

**Đã loại**: phần mở rộng Telegram của Jenkins (thêm phần mở rộng ít được bảo trì cho một lời gọi HTTP).

## R22. Việc nền dạng mới sau khi quay về bản cũ

**Quyết định**: Rà hành vi hiện tại của bộ chạy hàng chờ khi gặp loại việc chưa đăng ký ở phía **xử lý**; yêu cầu
đích: việc được **trả lại hàng chờ** với giờ chạy lùi 5 phút, **không** tính lần thử, **không** chuyển sang
`infra.dead_jobs`, ghi cảnh báo `queue.unknown_job_type` kèm chỉ số. Nếu hành vi hiện tại khác thì sửa trong module
`queue` kèm kiểm thử `test:queue`.

**Lý do**: ca biên của đặc tả ("không làm mất, không chôn"); là điều kiện để quay về bản trước an toàn về phía hàng
chờ, tương tự vai trò của R12 về phía CSDL.

## R23. Ranh giới với tính năng 007

**Quyết định**: `007` chưa có kế hoạch, nên 008 **tự sở hữu** những gì thuộc về việc đưa ứng dụng lên cụm: Helm
chart, Job migration, tập lệnh kiểm tra khói, tập lệnh đưa giao diện lên. Tài liệu "triển khai bằng tay" của `007`
(và hướng dẫn khẩn cấp khi Jenkins ngừng – FR-046) dùng chính các thứ này, chạy từ máy của SA. 008 nêu rõ những gì
nó **cần** từ mỗi môi trường ở [contracts/environment-inputs.md](./contracts/environment-inputs.md); mã Terraform
cho máy Jenkins đặt ở `infra/ci/` với trạng thái riêng, phần phụ thuộc nhà cung cấp tách thành module (theo tinh
thần FR-031 của `007`), bố cục sẽ khớp lại khi `007` lập kế hoạch.

**Lý do**: tránh hai tính năng cùng định nghĩa Deployment của `api`/`worker`; cho phép US1 và phần dựng ảnh hoàn
tất trước khi có môi trường.
