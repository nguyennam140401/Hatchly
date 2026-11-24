# Rà soát US3 (T036–T043, T039a) – 015 Cổng AI thật

Phạm vi: migration 0029/0030/0031, `internal/admin/*`, `internal/db/admin-functions.ts`, `internal/metrics.ts`, đường quyết toán T042 trong `gateway.service.ts`, khung nhìn hỗ trợ.
Ghi chú: các thay đổi chưa commit (working tree), đối chiếu trực tiếp với tệp.

Kiểm tra tĩnh: `pnpm check:boundaries` đạt; `pnpm check:secrets` đạt; `pnpm typecheck` lỗi duy nhất ở `tooling/test/check-wiki.spec.ts(38,41)` (ngoài phạm vi US3, không thuộc diff 015); `pnpm lint`: eslint đạt, prettier cảnh báo `apps/server/test/contracts/ai/ai-gateway.contract.ts` (qa) và 2 tệp ngoài phạm vi.

## Tuân thủ hiến chương
- I: bảng tenant (`ai_budgets`, `ai_reservations`, `ai_trend_allocations`, `ai_cost_ledger`) có RLS + chính sách; điểm cuối admin không nhận `accountId` (strictObject). Đạt.
- III: không số tiền cho khách (chỉ điểm cuối admin/support); tiền bigint micro-USD; đạt.
- IV: không import chéo module; hàm SQL chỉ chạm schema `ai_gateway` + `infra.audit_log` (tiền lệ 0028). Đạt.
- VII: lỗi 422 không chứa bí mật; chỉ số không mang tiền. Đạt.
- VIII: 5 thao tác quản trị đều ghi `infra.audit_log` cùng giao dịch với cấu hình (hàm SQL), lỗi kiểm toán hoàn tác cả hai. Đạt.

## Phát hiện

### TRUNG BÌNH
1. `apps/server/drizzle/migrations/0031_ai_gateway_admin_functions.sql:84-86` + `admin/pricing.service.ts:54-71` – kiểm 10× làm ở TS bằng lần đọc riêng, ngoài giao dịch và ngoài khóa tư vấn `pg_advisory_xact_lock` (dòng 82). Hai lần thêm giá đồng thời đều qua kiểm tra rồi cùng ghi (TOCTOU). Biến `o` đọc dưới khóa (dòng 84) chỉ để kiểm toán, không dùng để kiểm cứng. Đề xuất: chuyển kiểm 10× vào hàm SQL, so với `o` ngay sau khóa, RAISE `AI_PRICE_IMPLAUSIBLE`. Chủ: data-dev (SQL), backend-dev (TS).
2. `0031...sql:84-86` và `admin-functions.ts getCurrentPrice` – "giá hiện hành" lấy dòng `effective_from <= now()`, bỏ qua dòng đã hẹn giờ trong tương lai. Có thể thêm giá A (10×, hiệu lực +1 giờ) rồi giá B (10× so với giá cũ, hiệu lực +2 giờ) → tăng 100× qua hai bước mà mỗi bước đều "hợp lệ". Đề xuất: so với dòng có `effective_from` lớn nhất ≤ `p_effective_from` (dòng liền trước theo thời gian hiệu lực). Chủ: data-dev.
3. `admin/pricing.service.ts:49-52` – TTL 60 s so với `new Date()` của tiến trình API, trong khi giá hiện hành tính bằng `now()` của CSDL; lệch đồng hồ làm lệch ranh giới. Đề xuất: kiểm `p_effective_from >= now() + interval '60 seconds'` ở SQL (cùng lúc sửa mục 1). Chủ: data-dev.

### THẤP
4. `0031...sql:196-199, 237-240` – tham số NULL (`p_tier`/`p_rank`/`p_task`) làm `NOT IN` ra NULL nên không RAISE; sau đó lỗi `23502` không ánh xạ → 500 thay vì 422. Thân yêu cầu TS đã chặn nên chỉ là lớp phòng thủ thứ hai yếu. Đề xuất: thêm `p_tier IS NULL OR p_rank IS NULL` / `p_task IS NULL`. Chủ: data-dev.
5. `admin/routes.service.ts:46-52` – "có tuyến rank 2" chỉ kiểm `getRoute(...) !== null`, không kiểm `enabled`; và kiểm rồi ghi không cùng giao dịch (có thể tắt rank 2 xen giữa). Tác động vận hành bằng 0: `selectAttempts` (`routing/route-book.ts`) chỉ dùng rank 2 khi `enabled`. Đề xuất: kiểm `row.enabled` hoặc ghi chú rõ chỉ cần tồn tại. Chủ: backend-dev.
6. `admin/routes.service.ts:30-36` – `modelHasPrice` chỉ kiểm có dòng giá bất kỳ, không kiểm đúng `unit` theo bậc (`stt` cần `audio_minute`, còn lại `token`). Trỏ `stt` vào mô hình chỉ có giá token sẽ qua kiểm tra, rồi mọi lời gọi lỗi `AI_NOT_CONFIGURED` ở runtime. Đề xuất: truyền `unit` suy từ `tier` vào kiểm tra. Chủ: backend-dev.
7. `0031...sql:366-382` – `GRANT EXECUTE ... TO "support", "system"`; nhiệm vụ T039a ghi "chỉ `support`". `system` (Worker) không cần gọi các hàm này; thu hẹp bề mặt. Đề xuất: bỏ `"system"` khỏi GRANT, hoặc sửa tasks.md nếu có lý do. Chủ: data-dev.
8. `0031...sql:21` – `coalesce(p_id, gen_random_uuid())` sinh UUID v4 trái quy ước UUID v7 khi `p_id` NULL. TS luôn truyền v7 nên chỉ là dự phòng. Đề xuất: bắt buộc `p_id` NOT NULL. Chủ: data-dev.
9. `0030_ai_gateway_seed_support.sql:13` – chú thích "`system` được ghi cấu hình" trong khi 0030 chỉ thu quyền `app`; `system` vẫn giữ INSERT `model_prices` (bỏ qua kiểm 10×/kiểm toán nếu code Worker sau này ghi trực tiếp). Đề xuất: `REVOKE INSERT ON model_prices FROM "system"` vì mọi ghi đi qua hàm 0031. Chủ: data-dev.
10. `apps/server/test/contracts/ai/ai-gateway.contract.ts` – prettier cảnh báo định dạng. Chủ: qa.

## Chỉ số (metrics.ts) – ghi nhận việc còn lại, không phải lỗi
- Nhãn: chỉ `account_id` là nhãn phân tán cao, gắn ở `ai_gateway_reserve_duration_ms` và `ai_gateway_calls_total` (đúng hợp đồng mục 3). Lưu ý: histogram theo `account_id` nhân số chuỗi thời gian theo số bucket; cân nhắc bỏ nhãn này ở histogram khi lên quy mô (THẤP).
- Chưa nối: `recordCall` chỉ gọi ở nhánh thành công (`gateway.service.ts:414`), chưa có `outcome` lỗi / `blocked`; `generateStream` chưa ghi chỉ số; `registerOpenReservationsGauge` chưa được gọi ở đâu (chưa nối Worker); `recordProviderCall` chờ T046/T047. Ghi vào việc còn lại của US4/hoàn thiện, cảnh báo `jobs-and-alerts` dựa các chỉ số này sẽ chưa hoạt động.

## Kiểm tra đạt (không có lỗi)
- (a) 0031: mọi hàm `SECURITY DEFINER` đặt `search_path = pg_catalog, ai_gateway`, tên đối tượng đều chỉ định schema; không SQL động; tham số hóa; `admin_write_audit` REVOKE PUBLIC và không cấp EXECUTE; ràng buộc cứng (giá > 0 theo unit, granularity, soft < cap, tier/rank/task) ở SQL; chỉ THÊM hàm nên tương thích ngược.
- (b) Controller: đúng 5 `@StaffAccess('ai.pricing.manage')`, mỗi điểm cuối một; quyền chỉ admin (shared + core); `strictObject` mọi thân; lỗi nghiệp vụ 422 + `actions` tiếng Việt; lỗi khác ném lại → 5xx, giao dịch hoàn tác; `withinTenX` đúng 10× hợp lệ, 10×+1 bị từ chối cả hai chiều; TTL đúng 60 s (`now+60 s` hợp lệ); đệm giá cache cả dòng tương lai nên giá mới hiệu lực đúng giờ.
- (c) 0029: CHECK `model_prices_positive_matches_unit` + `unit`/granularity đặt sau khi cột là NULL-able đúng (kiểm tra NULL tường minh trong CHECK); trigger chặn UPDATE/DELETE/TRUNCATE gồm cả chủ sở hữu.
- (d) T042: kho thật ghi `provider`/`model_id`/`price_id` của lượt đang chạy (`planAttempt`), quyết toán dùng `price` của đúng lượt (không tra lại giá); thiếu giá → `AI_NOT_CONFIGURED` trước khi giữ chỗ.
- (f) Khung nhìn `support_ai_*`: chỉ cột số liệu/mã, không cột nội dung/bí mật; lọc theo `account.current_account_id()`; chỉ cấp `support`, thu hồi `app`/`system`.

## Kết luận
cần-sửa: 0 nghiêm trọng, 0 cao, 3 trung bình, 7 thấp. Không chặn nghiệp vụ US3 nếu chấp nhận rủi ro TOCTOU/chuỗi giá của quản trị viên đơn lẻ; nên sửa mục 1–3 cùng lượt trước khi bật driver `real`.
