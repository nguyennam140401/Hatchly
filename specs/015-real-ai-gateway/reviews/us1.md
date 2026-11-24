# Rà soát US1 (T025–T032) – 015-real-ai-gateway

Kết quả: **cần-sửa** (không có phát hiện nghiêm trọng; 0 vi phạm nguyên tắc I, II, III ở tầng kho ngân sách).
Đếm: nghiêm trọng 0, cao 1, trung bình 5, thấp 5.

Kiểm tra tĩnh: `check:boundaries` đạt; `check:secrets` đạt; `typecheck` lỗi duy nhất ở `tooling/test/check-wiki.spec.ts:38,41` (ngoài phạm vi US1);
`lint` 3 lỗi đều ở test của qa (`test/ai_gateway/rls-cross-account.db.spec.ts:179,191`, `test/contracts/ai/harness.ts:49`) – chuyển qa.

## Đối chiếu danh mục (a)–(l)

| Mục | Kết luận | Căn cứ |
|---|---|---|
| (a) reserve một UPDATE có điều kiện | Đạt | `db-budget-store.ts:220-234` (`used+reserved+est <= cap` trong WHERE, `CHECK ai_budgets_within_cap` là chốt cuối). Không đọc-rồi-ghi. Đọc `select` ở 236 chỉ để dựng ảnh chụp khi từ chối |
| (b) settle idempotent | Đạt | `:471-476` UPDATE state IN (held,calling) RETURNING; `null` → không cộng, không ghi sổ, không onCrossed. Release cùng khuôn `:398-405`. Khóa dòng giữ chỗ trước, ngân sách sau; reserve chỉ khóa ngân sách và chèn dòng mới → không có chu trình khóa |
| (c) kẹp trần, over_cap | Đạt có lưu ý | `:487-490` kẹp theo `cap − reserved_sau` (chặt hơn `cap − used` của T026) để giữ CHECK khi còn giữ chỗ khác; `over_cap = total − usedAfter` giữ đúng bất biến `used = Σcost − Σover_cap` (data-model 90). Xem CAO-1 |
| (d) cờ 80/100 + onCrossed | Đạt | `:497-520` UPDATE … WHERE notified_x=false RETURNING; onCrossed `:540` cùng `db`; ném → hoàn tác cả sổ/cờ/chuyển trạng thái. Retry quyết toán thấy `null` → không phát lại |
| (e) tạo ngân sách chu kỳ | Đạt | `:241-250` ON CONFLICT DO NOTHING trên `ai_budgets_account_cycle_key`; giao dịch thua chờ giao dịch thắng commit rồi UPDATE tiếp → một dòng |
| (f) release_stale | Đạt có lưu ý | `:618-676` held→released, calling→settle theo ước tính + `anomaly='unsettled'`; chạy lần hai: UPDATE không trúng → 0. Xem THẤP-2 |
| (g) mã yêu cầu logic | Đạt | `:197-219` settled→duplicate/settled, held\|calling→in_progress; released bị loại khỏi chỉ mục duy nhất từng phần (0029 dòng 196) nên chạy lại được; vi phạm 23505 `ai_reservations_request_key` bắt ở `:174` (giao dịch thua đã hoàn tác) |
| (h) lỗi/hết giờ trả giữ chỗ | Đạt phần lớn | `gateway.service.ts:256-258`, `:505`. Kẽ hở: TRUNG BÌNH-2/3 |
| (i) không dùng `app.account_id` | Đạt | grep `app.account_id\|current_setting` trong `ai_gateway` và `ai-cycle-anchor.ts` không có kết quả; chỉ `account.current_account_id()` + `tenantTx`/`systemTx`. Bảng khách hàng có RLS `tenant_isolation` (0029:205-207, 266-267); `system_*` không RLS (không có `account_id`, đúng thiết kế) |
| (j) không cache ngân sách | Đạt | mốc chu kỳ đọc mỗi lần (`ai-cycle-anchor.ts`); chỉ giá/tuyến/cấu hình có TTL ≤ 60 s |
| (k) hẹn +15 phút cùng giao dịch | Đạt | `onReserved(db, …)` gọi trước commit `:270`; `enqueue` dùng giao dịch ngữ cảnh (ALS) → hẹn và giữ chỗ cùng commit/rollback. `runAfter = reservedAt + 15' + 5s`, `dedupeKey` theo giữ chỗ |
| (l) retry quyết toán một lần | Đạt | `gateway.service.ts:186-200` đúng 2 lần thử; lần hai cũng lỗi → `ai.settle_failed` (không lời nhắc/tiền), giữ chỗ `calling` chờ dọn |

Hiến chương: III – không đường nào cho tiền ra khách (`getUsage` chỉ `%`/state/ngày; sự kiện chỉ task, tier, model, provider, mã lý do). VIII – nhật ký không chứa lời nhắc. IV – ranh giới sạch (account qua `AccountPublicApi`, notifications qua `NOTIFICATIONS`). V – bộ xử lý nền idempotent.

## Phát hiện

### CAO-1 – Mốc 100% có thể không bao giờ bật (SC-011 "0 thiếu")
`db-budget-store.ts:509-520` (+ kẹp ở `:487-490`). Cờ `notified_100` chỉ bật khi `used >= cap`. Nhưng reserve chặn mọi lời gọi khi `used + reserved + est > cap`, nên thực tế `used` dừng ở `cap − (vài trăm micro-USD)` và không bao giờ chạm đúng `cap`; ngoài ra khi còn giữ chỗ khác `used` bị kẹp về `cap − reserved_sau < cap`. Hậu quả: tài khoản bị khóa AI (`getUsage.state='blocked'`) mà không nhận thông báo `ai_usage_100` (FR-030, US6 kịch bản 2). Đề xuất: định nghĩa 100% là "không còn đủ cho lời gọi nhỏ nhất" (`cap − used − reserved < minEstimate` sau quyết toán, cùng tiêu chí `blocked` của `getUsage`) hoặc `used >= cap` HOẶC bị kẹp (`over_cap > 0`); thống nhất với `getUsage` rồi cập nhật data-model. Dev: backend-dev. Cần PM chốt định nghĩa (câu hỏi bên dưới).

### TRUNG BÌNH-1 – Lượt dự phòng ghi sai tuyến/giá trong giữ chỗ (đã nêu bởi backend)
`gateway.service.ts:237-242` và `:419-423` không truyền `provider/modelId/priceId/traceId`; `db-budget-store.ts:122-157` rơi về `attempts[0]` (rank 1) cho CẢ lượt dự phòng → `ai_reservations.provider/model_id/price_id` của lượt dự phòng là của nhà cung cấp chính, trong khi sổ lại ghi nhà cung cấp thực (draft ghi đè) – hai nguồn lệch nhau, truy vết giá (FR-020) sai. Đồng thời `PriceBook` trong bộ nhớ của gateway và `DbPriceSource` của kho là hai nguồn giá khác nhau (có thể lệch trong cửa sổ TTL). Cũng chưa truyền `traceId` nên `ai_reservations.trace_id` luôn NULL (VIII). Sửa: T048/T049 truyền `{provider, modelId, priceId, traceId}` từ tuyến đã chọn cho từng lượt; làm `provider/modelId/priceId` bắt buộc khi driver `real` để không lặng lẽ suy ra. Dev: backend-dev.

### TRUNG BÌNH-2 – `markCalling` ném lỗi làm rò giữ chỗ 15 phút
`gateway.service.ts:251` (và `:430`) nằm ngoài `try`. Nếu `markCalling` ném (mất kết nối CSDL), giữ chỗ `held` không được trả; chờ bộ dọn 15 phút (khóa ngân sách tới đó). Hiến chương III "lỗi MUST trả lại giữ chỗ". Sửa: đặt `markCalling` trong `try` (hoặc try/catch riêng gọi `release` rồi ném lại). Dev: backend-dev.

### TRUNG BÌNH-3 – `provider.stream(...)` tạo ngoài `try` (luồng)
`gateway.service.ts:443-448`. Nếu `stream()` ném đồng bộ (bộ chuyển đổi thật ở T049 có thể làm vậy khi sai cấu hình), giữ chỗ `calling` không được trả, `firstTimer`/`total` rò (không vào `finally`); sau 15 phút bị quyết toán THEO ƯỚC TÍNH (tính tiền khách cho lời gọi chưa chạy). Sửa: dời `provider.stream(...)` vào trong `try`. Dev: backend-dev.

### TRUNG BÌNH-4 – Lịch dọn ngân sách hệ thống chưa nối cho driver `real`
`ai_gateway.module.ts:147-154` + `jobs.ts:67-80`: `defineStaleSystemSchedule()` chỉ gọi ở nhánh fake sandbox; nhánh real chỉ `registerAiJobHandlers`. `reserveSystem` cũng không gọi `onReserved`. Giữ chỗ `held|calling` treo của ngân sách hệ thống (xu hướng) sẽ không bao giờ được dọn → `reserved` rò vĩnh viễn, trần tuần mòn dần. Nay chưa gây lỗi vì nhánh real còn ném lỗi khởi động, nhưng phải xử lý trước T049 (hoặc ghi vào task). Sửa: gọi `defineStaleSystemSchedule()` ở nhánh real/worker. Dev: backend-dev.

### TRUNG BÌNH-5 – Gọi Cổng AI bên trong giao dịch của bên gọi sẽ chung giao dịch
`db-budget-store.ts:168-171, 99-101` + `core/db/transaction.ts` (`reuseOrConflict`): `tenantTx` lồng nhau dùng lại giao dịch ngoài. Nếu module khác gọi `generate()` khi đang ở `tenantTx`, (1) khóa dòng ngân sách bị giữ suốt thời gian gọi nhà cung cấp (tuần tự hóa mọi lời gọi cùng tài khoản), (2) lỗi 23505 trùng mã yêu cầu làm giao dịch ngoài ở trạng thái abort, `catch` ở `:174` không cứu được, (3) hoàn tác giao dịch ngoài xóa luôn giữ chỗ nhưng nhà cung cấp đã tính tiền. Đề xuất: ghi quy ước vào `apps/server/docs/database.md`/quickstart (không gọi Cổng AI trong giao dịch) và/hoặc `reserve/settle` ném lỗi khi phát hiện giao dịch bao ngoài. Dev: backend-dev (tài liệu: PM).

### THẤP-1 – `releaseInTx` cho nhánh `held` vẫn nhận cả `calling`
`db-budget-store.ts:402`. Bộ dọn đọc trạng thái ở một giao dịch rồi `release` ở giao dịch khác; nếu giữ chỗ vừa chuyển `held→calling` trong khoảng đó nó bị trả (bỏ qua chi phí nhà cung cấp). Rất hiếm (giữ chỗ phải tuổi > 15 phút), nhưng spec FR-009 dùng `WHERE state = :expected`. Sửa: tham số hóa `expected` ('held' cho nhánh dọn; OPEN cho lỗi gọi). Dev: backend-dev.

### THẤP-2 – Mỗi lời gọi AI sinh một việc `release_stale` dù đã đóng
`db-budget-store.ts:270` + `jobs.ts:83-95`: mọi giữ chỗ đẻ một việc chạy sau 15 phút, 99% là no-op đọc bảng. Ở tải 10× (hàng chục nghìn lời gọi/tháng) vẫn nhỏ, nhưng có thể hủy việc khi quyết toán/trả (`boss.cancel` theo `dedupeKey`) hoặc chuyển sang quét định kỳ theo ngưỡng. Không chặn. Dev: backend-dev.

### THẤP-3 – Nuốt lỗi quyết toán không ghi nguyên nhân
`gateway.service.ts:190-199`: `catch {}` bỏ cả lần lỗi đầu lẫn lần hai, không có lớp lỗi/mã SQLSTATE (chỉ có `reason: 'settle_failed'`). Hỗ trợ khó phân biệt "ném onCrossed" với "thiếu phân vùng sổ" với "mất kết nối". Sửa: thêm trường `error_class` (tên lớp, không thông điệp) vào sự kiện. Dev: backend-dev.

### THẤP-4 – Nhiều giao dịch rời rạc mỗi lời gọi (hiệu năng, ≤ 50 ms)
Mỗi `generate` thực hiện: đọc mốc tài khoản (1 giao dịch), `usage` (1), `reserve` (1, gồm hẹn việc), `markCalling` (1), `settle` (1) – 5 vòng đi về CSDL trước kết quả; lượt dự phòng thêm 3. Khối đường tới hạn của kiểm ngân sách (reserve) chỉ là một giao dịch, nên yêu cầu "kiểm ngân sách ≤ 50 ms" khả thi; nhưng nên đo ở T0xx hiệu năng. Có thể gộp `markCalling` vào `reserve` không? Không (cần ghi sau khi chắc chắn gọi) – giữ nguyên, chỉ lưu ý. Dev: backend-dev.

### THẤP-5 – Trùng lặp account/system
`db-budget-store.ts:462-599` (settleAccount/settleSystem gần giống hệt), `:396-433`, `:186-338`. Chấp nhận được vì khác bảng/kiểu Drizzle; nếu thêm trường phải sửa hai nơi. Cân nhắc hàm chung nhận bảng + điều kiện. Dev: backend-dev.

## Ghi chú theo yêu cầu PM
- `ReserveMeta.provider/modelId/priceId` tùy chọn: lượt dự phòng PHẢI truyền (TRUNG BÌNH-1); T048 nên đổi kiểu thành bắt buộc cho driver real.
- Nhánh `real` còn ném lỗi khởi động tới T049 (`ai_gateway.module.ts:152`): thông điệp rõ, không lộ bí mật; chấp nhận tạm. Khi gỡ phải nhớ TRUNG BÌNH-4.
- Phạm vi sở hữu: các tệp US1 trong `ai_gateway/**`, `account/internal/ai-cycle-anchor.ts`, migration 0029/0030 thuộc backend-dev/dba theo `.specify/ownership.json`; không thấy tệp ngoài phạm vi trong phần US1 đã đọc.
- Đã loại trừ các lỗi test đã biết (thiếu `startTestProducer`, sort chuỗi ở release-stale queue spec).
