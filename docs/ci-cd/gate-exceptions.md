# Ngoại lệ vượt cổng chất lượng

Dùng khi một cổng đỏ vì lý do tạm thời (hạ tầng chập chờn, luật mới bắt nhầm) mà việc phát hành không thể chờ.
Ngoại lệ là **một tệp trong pull request cần vượt**, do người có vai `release-manager` duyệt – không ai tự cho
mình ngoại lệ trên giao diện Jenkins (FR-009).

## Tạo ngoại lệ

1. Trong chính pull request đang đỏ, thêm `ops/ci/exceptions/<YYYY-MM-DD>-<cổng>.yml` (ngày là hôm nay, UTC):

   ```yaml
   gate: lint
   reason: Luật lint mới bắt nhầm tệp sinh tự động, sửa cấu hình ở pull request sau
   approvedBy: ten-github-cua-nguoi-duyet
   expiresAt: '2026-11-18T00:00:00Z'
   pullRequest: 42 # hoặc commit: <sha>
   ```

2. Người có vai `release-manager` (xem `ops/ci/team.json`) duyệt pull request – thư mục này thuộc `CODEOWNERS`.
3. `pnpm verify --ci` báo cổng đó là `! ngoại lệ`, kiểm tra `ci/gates` đạt; ngoại lệ hiện trong Checks, thông
   báo Telegram và `DeploymentRecord.gates.excepted`.

## Quy tắc

| Trường                   | Quy tắc                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `gate`                   | tên một bước của `pnpm verify` (`pnpm verify --only <sai tên>` liệt kê tên hợp lệ) |
| `reason`                 | ≥ 20 ký tự: vì sao phải vượt và kế hoạch sửa                                       |
| `approvedBy`             | tên GitHub có vai `release-manager`                                                |
| `expiresAt`              | ISO-8601 UTC, **không quá 7 ngày** kể từ ngày trong tên tệp                        |
| `pullRequest` / `commit` | bắt buộc một trong hai – giới hạn phạm vi áp dụng                                  |

**Không bao giờ vượt được**: `test:db` (gồm kiểm thử truy cập chéo tenant), `check:secrets`,
`check:secrets:test-logs`, `db:immutable`, `check:release-source`. Tệp ngoại lệ cho các cổng này bị `pnpm
check:pipeline` báo lỗi.

## Hết hạn và dọn dẹp

Ngoại lệ hết hạn tự vô hiệu – cổng đỏ lại chặn như thường. `pnpm check:pipeline` nhắc xóa tệp đã hết hạn (cảnh
báo, không làm đỏ). Xóa trong pull request kế tiếp.
