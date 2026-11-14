# Hợp đồng: lệnh `pnpm infra` và hai quy trình tự động (FR-004, FR-026, FR-027, FR-028, FR-034)

Điểm vào duy nhất: `pnpm infra <lệnh> [<env>] [tùy chọn]` → `node tooling/infra/cli.mjs`. Người vận hành
**không gọi `terraform` trực tiếp** với môi trường thật; mọi lớp chặn nằm trong CLI này.

`<env>` ∈ `staging` | `production`. Mọi lệnh in tiếng Việt, không bao giờ in giá trị bí mật.

## 1. Chứng thực

CLI đọc từ biến môi trường của tiến trình, theo hồ sơ `infra/.credentials/<env>.env` (gitignore, người vận
hành tự tạo theo mẫu `.env.example` trong cùng thư mục):

| Biến | Dùng cho |
|---|---|
| `VNGCLOUD_CLIENT_ID`, `VNGCLOUD_CLIENT_SECRET` | Tài khoản dịch vụ `terraform-<env>` (hoặc `drift-<env>` trên hệ thống tự động) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Khóa S3 của cùng tài khoản dịch vụ: bucket trạng thái + quản lý bucket |
| `KUBECONFIG` | Do `pnpm infra kubeconfig <env>` ghi vào `infra/.credentials/<env>.kubeconfig` |

CLI từ chối chạy khi hồ sơ của `<env>` chứa định danh thuộc môi trường khác (so `project_id` trả về với tệp
tham số) – chặn dùng nhầm chứng thực.

## 2. Lệnh

| Lệnh | Việc làm | Cần tài khoản |
|---|---|---|
| `check` | Kiểm tra tĩnh (mục 3) | Không |
| `bootstrap-check <env>` | Kiểm danh sách khởi tạo một lần ([one-time-bootstrap.md](one-time-bootstrap.md)) | Có |
| `plan <env> [--stack cloud\|platform]` | Tạo bản xem trước, lưu vào `infra/.plans/<env>/`, in tóm tắt; thao tác trên tài nguyên được bảo vệ in **đầu tiên**, có dấu `!!` | Có |
| `apply <env> [--stack …] [--confirm-data-loss]` | Áp dụng **đúng** bản xem trước đã lưu; ghi bản ghi áp dụng | Có |
| `up <env>` | Trình tự dựng đầy đủ cho lần đầu: `plan`+`apply` `cloud` → `kubeconfig` → `plan`+`apply` `platform` → `secrets init` → in bản ghi DNS. Chạy lại được; ở `production` vẫn dừng hỏi xác nhận trước mỗi `apply` | Có |
| `outputs <env> [--json]` | Đầu ra bàn giao ([handoff-outputs.md](handoff-outputs.md)) | Có (chỉ đọc) |
| `dns-check <env>` | Tra từng bản ghi trong `dns_records`, so với giá trị mong đợi; in bản ghi thiếu/sai; kiểm chứng chỉ đã cấp | Không (DNS công khai) |
| `kubeconfig <env>` | Lấy kubeconfig vào `infra/.credentials/` | Có |
| `secrets init <env>` | Tạo các `Secret` tự sinh nếu chưa có | Có |
| `secrets set <env> <secret> <khóa>` | Nhập một giá trị từ bàn phím (không hiện chữ) | Có |
| `secrets rotate <env> <tên>` | Xoay mật khẩu vai trò CSDL / `AUTH_THROTTLE_SECRET`: sinh mới → cập nhật CSDL → cập nhật `Secret` → nhắc khởi động lại | Có |
| `secrets list <env>` | Tên, khóa, nguồn, thời điểm xoay – **không** có giá trị | Có |
| `drift <env> [--stack cloud\|platform]` | Kiểm tra lệch bằng chứng thực hiện có; mặc định cả hai stack | Có (chỉ đọc là đủ) |
| `power staging off\|on` | FR-034 | Có |
| `smoke <env>` | Bộ kiểm tra khói SC-003 + phép thử cô lập SC-005, SC-009 | Có |
| `drill start --from <env> --target-time <ISO>` | Dựng môi trường tạm, khôi phục CSDL | Có |
| `drill verify [--marker <sql>]` | Kiểm tra, đo, ghi bản ghi diễn tập | Có |
| `drill destroy` | Hủy môi trường tạm, kiểm không còn tài nguyên | Có |
| `records <env> [--last N]` | Liệt kê bản ghi áp dụng / diễn tập | Có (chỉ đọc) |

Không có lệnh hủy `staging`/`production`. Hủy thử nghiệm hẳn là thủ tục trong tài liệu vận hành, dùng
`terraform` trực tiếp có chủ đích.

## 3. `check` – kiểm tra tĩnh

Chạy lần lượt, không dừng ở lỗi đầu, in bảng tổng kết (cùng kiểu `pnpm verify`):

1. `terraform fmt -check -recursive infra/`
2. Với mỗi stack: `terraform init -backend=false` + `terraform validate`
3. `tflint --recursive`
4. `terraform test` cho từng stack (`infra/stacks/cloud/tests/`, `infra/stacks/platform/tests/`, `mock_provider`) – các bất biến ở
   [provider-layer.md](provider-layer.md) mục 4 và [environment-parameters.md](environment-parameters.md) mục 3
5. So `staging.tfvars` với `production.tfvars` (khóa khác nhau ngoài danh sách cho phép → lỗi; hai bản
   `variables.shared.tf` khác nhau → lỗi)
6. `node tooling/scan-secrets.mjs infra tooling/infra` (đã mở rộng cho `.tf`, `.tfvars`, `.hcl`)
7. Kiểm thử đơn vị của chính CLI (`tooling/test/infra/*.spec.ts`): bộ chặn (mục 4) chạy trên các tệp JSON
   bản xem trước mẫu

Mã thoát: `0` đạt · `1` có bước lỗi · thiếu `terraform`/`tflint` → in `SKIPPED: …` và thoát `0` khi chạy trong
`pnpm verify`, thoát `1` khi chạy trong quy trình tự động (`CI=true`).

## 4. `plan` / `apply` – các lớp chặn

Áp dụng cho mọi môi trường: cây git sạch (trong `infra/` và `tooling/infra/`); khóa trạng thái; chứng thực
đúng môi trường.

Riêng `production`:

| Lớp | Kiểm ở | Điều kiện | Thông báo khi chặn |
|---|---|---|---|
| (a) Đã chạy ở thử nghiệm | `plan` và `apply` | Có bản ghi áp dụng của **cả hai** stack ở thử nghiệm với đúng `definitionHash` hiện tại | "Thay đổi này chưa áp dụng thành công ở thử nghiệm (dấu …). Chạy `pnpm infra apply staging` trước." |
| (b) Đúng bản đã lưu | `apply` | Có tệp bản xem trước; `definitionHash` và `paramsHash` tính lại trùng `meta.json`; chưa quá 24 giờ; Terraform chấp nhận (trạng thái chưa đổi) | "Mã hoặc tham số đã đổi sau khi xem trước. Chạy lại `pnpm infra plan production`." |
| (c) Tài nguyên chứa dữ liệu | `plan` (cảnh báo) và `apply` (chặn) | Không có `delete`/`replace` trên tài nguyên được bảo vệ – hoặc: bảo vệ xóa của đúng tài nguyên đó đã được gỡ ở một lần áp dụng **trước** (có bản ghi) **và** có `--confirm-data-loss` **và** người vận hành gõ lại `production` | "Bản xem trước sẽ XÓA/THAY THẾ: <danh sách>. …" |

Danh sách tài nguyên được bảo vệ nằm ở `tooling/infra/protected-resources.mjs` (loại tài nguyên + điều kiện),
có kiểm thử đơn vị. Thêm tài nguyên chứa dữ liệu mới vào hạ tầng mà không thêm vào danh sách → kiểm thử
`infra/stacks/cloud/tests/protected-coverage` lỗi (đối chiếu nhãn `data = "true"` trên tài nguyên với danh sách).

Sau `apply` thành công: ghi bản ghi áp dụng ([data-model.md](../data-model.md) mục 6), xóa tệp bản xem trước.

`staging` dùng cùng lệnh; lớp (a) không áp dụng, lớp (b) áp dụng, lớp (c) chỉ cảnh báo và hỏi `y/N`.

## 5. Mã thoát chung

| Mã | Nghĩa |
|---|---|
| 0 | Thành công / không lệch / không thay đổi |
| 1 | Lỗi thực thi hoặc kiểm tra không đạt |
| 2 | `drift`: có lệch · `plan`: có thay đổi (với `--detailed-exitcode`) |
| 3 | Bị một lớp chặn từ chối (a/b/c, khóa nguồn, sai chứng thực) |
| 4 | Thiếu điều kiện khởi tạo (`bootstrap-check`, `dns-check` chưa đạt) |

## 6. Quy trình tự động (GitHub Actions)

| Tệp | Kích hoạt | Việc | Chứng thực |
|---|---|---|---|
| `.github/workflows/infra-static.yml` | Thay đổi đụng `infra/**`, `tooling/infra/**`, tệp quy trình | `pnpm infra check` với `CI=true` | Không |
| `.github/workflows/infra-drift.yml` | Lịch `0 23 * * *` UTC (06:00 UTC+7) + chạy tay | Ma trận `[staging, production]`: `pnpm infra drift <env> --stack cloud` | Bí mật của GitHub Environment `<env>-readonly`: tài khoản `drift-<env>`, khóa S3 chỉ đọc bucket trạng thái (không có kubeconfig) |

Kết quả `drift`:

- Mã 0 → đóng issue `infra-drift:<env>` nếu đang mở.
- Mã 2 → mở/cập nhật issue `infra-drift:<env>` với danh sách `địa chỉ tài nguyên: thuộc tính lệch`; việc thất bại.
- Mã khác → việc thất bại, issue ghi "lần chạy lỗi" kèm bước lỗi (FR-027 "báo khi lần chạy thất bại").

Phạm vi: chỉ stack `cloud`, vì điểm quản trị cụm chỉ mở cho `admin_cidrs` (FR-009). Lệch trong cụm được phát hiện khi chạy `plan` hoặc `drift <env>` trên máy người vận hành (research R10).

Ràng buộc: hai quy trình này **không bao giờ** có bước `apply`; không bí mật nào trên GitHub có quyền ghi vào
hạ tầng (FR-026). Kiểm thử `tooling/test/infra/workflows.spec.ts` đọc hai tệp YAML và lỗi nếu thấy `apply`
hoặc tên bí mật ngoài danh sách chỉ đọc.

## 7. `power staging off|on`

1. Từ chối nếu `power_lock = true`, hoặc `<env>` ≠ `staging`.
2. `off`: `plan` + `apply` stack `cloud` với `powered=false` → ghi `runtime/power.json`.
3. `on`: `plan` + `apply` `cloud` với `powered=true` → chờ máy sẵn sàng → `plan` + `apply` `platform` (không
   đổi gì nếu không có lệch) → chờ `api`/`worker`/CSDL sẵn sàng → `dns-check` → in tổng thời gian.
4. Mọi lệnh `plan`/`drift` khác đọc `runtime/power.json` để truyền đúng `powered`.

## 8. `drill`

`start` sinh `infra/envs/drill.tfvars` từ mẫu (không commit), dựng hai stack với khóa trạng thái `drill/…`,
đặt `recovery.target_time`, ghi `startedAt`. `verify` chờ `Cluster` sẵn sàng, chạy truy vấn đánh dấu, tính
`durationSeconds` và `dataLossSeconds`, kiểm bốn phép thử cô lập của US4 kịch bản 2 (không SMTP, không ra
internet, không địa chỉ công khai, không ghi/xóa được bucket sao lưu), cộng không kết nối được tới `pg-rw` của CSDL đang chạy ở môi trường nguồn (FR-028), ghi bản ghi. `destroy` hủy, rồi liệt kê
tài nguyên mang nhãn `environment=drill` – phải rỗng – và cập nhật `destroyedAt`.

Chỉ một môi trường tạm tồn tại tại một thời điểm; `start` từ chối khi trạng thái `drill/…` còn tài nguyên.
