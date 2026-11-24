# Kiểm tra sau Phase 1–2 (015-real-ai-gateway)

Ngày chạy: 2026-11-24. `TEST_DATABASE_ADMIN_URL` theo giá trị mẫu trong `.env.example`.

| Lệnh | Kết quả | Số test |
|---|---|---|
| `pnpm test` (bộ nhớ) | apps/server ĐẠT; packages/shared ĐẠT sau sửa; tooling và apps/web có lỗi có sẵn | server 690 đạt, 1 expected-fail, 5 bỏ qua; shared 61/61 (sau sửa); tooling 300 đạt; web 510 đạt, 2 hỏng |
| `pnpm test:db` | 1 hỏng chập chờn (đạt khi chạy riêng) | 1102 đạt, 1 hỏng, 8 bỏ qua (101 tệp) |
| `pnpm test:queue` | 1 hỏng chập chờn (đạt khi chạy riêng) | 208 đạt, 1 hỏng, 5 bỏ qua (37 tệp) |
| `pnpm check:boundaries` | ĐẠT | 0 vi phạm (737 module) |
| `pnpm db:check` | ĐẠT | 12 schema, 50 bảng, 5 khung nhìn, 0 vi phạm |
| `pnpm db:lint-migrations` | ĐẠT | 0 vi phạm |
| eslint + prettier (apps/server, packages/shared, specs/015) | ĐẠT sau sửa | 0 lỗi |
| `pnpm typecheck` | Chỉ lỗi có sẵn | `tooling/test/check-wiki.spec.ts(38,41)` |

## Lỗi do 015 và đã sửa (tệp kiểm thử của qa)
- `packages/shared/test/auth.spec.ts`: danh sách quyền thiếu `ai.pricing.manage`, `ai.cost.view` (đúng 20 quyền); support nhận `ai.cost.view`; admin nhận cả hai. Đã cập nhật.
- Lint trong `apps/server/test/ai_gateway/token-estimate.spec.ts` (thay spread chuỗi bằng `Array.from`), `support-views.db.spec.ts` (`endsWith`, ép kiểu thừa), `account/ai-cycle-anchor.spec.ts` (ép kiểu thừa); prettier cho `support-views.db.spec.ts` và `trend-allocations-isolation.db.spec.ts`.

## Lỗi có sẵn ở dev, không do 015
- `tooling/test/check-wiki.spec.ts` (kiểu), `tooling/test/infra/power.spec.ts`.
- `apps/web/test/media/media-page.spec.tsx` ("đang tải → aria-busy") và `apps/web/src/features/channels/ChannelsPage.spec.tsx` (trạng thái trống). 015 không đổi mã web; nghi ngờ có sẵn, nên PM xác nhận trên `dev` nếu cần.

## Chập chờn khi chạy song song (đạt khi chạy riêng, không do 015)
- `apps/server/test/auth/meta-callbacks.e2e.spec.ts:80` (test:db): đếm 2 dòng `account.meta_deletion…` thay vì 0, nghi ngờ dữ liệu chung hoặc thứ tự giữa các tệp chạy song song.
- `apps/server/test/queue/purge-account.queue.spec.ts` ("gọi lại → 0, 0"): nghi ngờ dùng chung dữ liệu hàng chờ khi tải cao.

## Lỗi mã sản xuất
Không có.
