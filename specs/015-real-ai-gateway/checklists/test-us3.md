# Kiểm thử US3 (T039–T041, điểm cuối /api/v1/admin/ai/*)

Ngày chạy: 2026-11-24. CSDL: `TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres_dev_only@localhost:5432/postgres`.

## Sửa trong lượt này
- `apps/server/test/ai_gateway/admin.db.spec.ts` (ca phân quyền): chủ/cộng tác viên (không phiên nhân viên) nhận 401 hoặc 403 (không 2xx/404); hỗ trợ (đã đăng nhập nhân viên, thiếu `ai.pricing.manage`) phải đúng 403; ẩn danh 401/403. Không đổi hành vi cổng nhân viên.
- `apps/server/vitest.config.mts`: loại `price-effective.spec.ts` và `ledger-reconcile.spec.ts` khỏi `pnpm test` (chạy ở `test:db`).

## Kết quả chạy
| Lệnh | Kết quả |
|---|---|
| `test:db` test/ai_gateway + test/contracts/ai | 20 tệp đạt, 262 đạt, 18 bỏ qua, 0 hỏng |
| `test:db` test/auth + test/db | 66 tệp đạt, 747 đạt, 0 hỏng |
| `pnpm test` (vitest run) | 66 tệp đạt, 718 đạt, 1 expected fail, 18 bỏ qua |
| `test:queue` ai_gateway-release-stale | 5/5 đạt |
| eslint + prettier tệp sửa | sạch |

## 4 ca đỏ backend-dev báo
Không tái hiện: cả bộ `test/auth` (gồm `oauth-login.e2e.spec.ts:352`) và `ai.db.contract.spec.ts` (ca "hủy trước chữ đầu tiên") đều xanh trong lượt chạy đầy đủ. Kết luận: chập chờn (phụ thuộc thời gian/tải khi chạy song song), không do mã 015. Chưa chạy lặp nhiều lần để định lượng; nếu tái diễn thì báo PM kèm log.

## Smoke hàm SQL 0031 qua `admin.db.spec.ts`
Các ca POST prices, PUT settings, PUT routes, PUT task-fallback, POST provider-invoices (ghi dữ liệu + dòng kiểm toán đủ trường, chặn accountId trong thân yêu cầu) đều đạt với CSDL thật; không phát hiện lỗi hàm SQL cần giao data-dev.
