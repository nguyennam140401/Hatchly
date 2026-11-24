# Rà soát vòng 2 (sửa US1) + US2 (T033–T035) – 015-real-ai-gateway

Kết quả: **cần-sửa**. Đếm: nghiêm trọng 0, cao 1, trung bình 3, thấp 4.
Kiểm tra: `pnpm check:boundaries` đạt, `pnpm check:secrets` đạt. `typecheck`/`lint` không chạy lại (script gốc không có `typecheck`; kết quả vòng 1 còn hiệu lực).

## (a) Các lỗi vòng 1

| Lỗi vòng 1 | Kết luận | Căn cứ |
|---|---|---|
| TB-1 lượt dự phòng ghi sai tuyến/giá | Đã sửa | `gateway.service.ts:251-258, 437-443` truyền `attempt: i` + `traceId`; `db-budget-store.ts:159-205` chọn `attempts[attempt]`, lấy giá theo (provider, model) của lượt đó, `trace_id` được ghi. Còn lệch phía tính tiền: xem TB-2 |
| TB-2 `markCalling` ngoài khối bảo vệ | Đã sửa | `gateway.service.ts:226-234` (`markCallingOrRelease`: lỗi thì `release` rồi ném lại), dùng ở `:267` và `:450` |
| TB-3 `stream()` ngoài `try` | Đã sửa | `:463-470` trong `try`, `finally` `:535-539` dọn hai bộ hẹn giờ và trình nghe hủy |
| TB-4 lịch dọn hệ thống ở nhánh real | Đã sửa | `ai_gateway.module.ts:~150-158` gọi `defineStaleSystemSchedule()` khi `unit==='worker'`. Hiện chưa có tác dụng vì nhánh real còn ném lỗi (T049) |
| TB-5 gọi Cổng AI trong giao dịch | Đã sửa (có lưu ý) | `db-budget-store.ts:111-117` `assertNoOuterTx()` bằng `currentTx()`, gọi ở `reserve:212`, `markCalling:434`, `release:486`, `settle:659`. Lưu ý THẤP-3 |
| CAO-1 mốc 100% không bao giờ bật | **Chưa sửa trong thực tế** | Xem CAO-1 bên dưới |

## Phát hiện

### CAO-1 – `minCallEstimate` ≈ 5 micro-USD nên mốc 100% và `blocked` hầu như không bao giờ bật
`internal/estimate.ts:50-52` + `db-budget-store.ts:124-138` + `budget-store.ts:148-154`. `minCallEstimateMicro()` tính `estimateTokens(cheap_vision, 0 token vào, 1 token ra)`. Với giá seed Haiku (đầu ra 5.000.000 micro/1M token, `0030:~46`) kết quả là **5 micro-USD**. Lời gọi thật ước tính từ hàng trăm tới hàng chục nghìn micro-USD. Reserve chặn khi `cap − used − reserved < est`, nên `used` dừng ở `cap − (một khoảng tới est)`. Khoảng đó rơi vào `≤ 5` với xác suất ~0,01%, nên cờ `notified_100` và `getUsage.state='blocked'` về thực tế vẫn không bật. Tài khoản bị khóa AI (mọi `reserve` trả hết ngân sách) mà không có thông báo `ai_usage_100` (FR-030, SC-011 "0 thiếu"); UI vẫn báo `cheap_model`/`normal`. Các test dùng `MIN` tự chọn (`tier-threshold.spec.ts:57`) nên không phát hiện. Đề xuất: đổi `minCallEstimate` thành ước tính thực tế của lời gọi nhỏ nhất, vd `max(thực tế nhỏ nhất, hằng số cấu hình AI_MIN_CALL_ESTIMATE_MICRO)`. Gợi ý: một khung hình `IMAGE_INPUT_TOKENS` + `maxOutputTokens` nhỏ nhất cho phép. Hoặc bật cờ khi bất kỳ `reserve` bị từ chối vì hết ngân sách (cùng tiêu chí với `blocked`) và theo số đã quyết toán. Thêm test với giá seed thật. Dev: backend-dev. PM quyết định định nghĩa (theo số đã quyết toán là quyết định đã chốt, còn giá trị `minEstimate` thì chưa đủ).

### TRUNG BÌNH-1 – `getUsage()` ném `AI_BUDGET_EXHAUSTED` khi không có mốc chu kỳ
`gateway.service.ts:579` → `keyForAccount` → `db-budget-store.ts:145-148` (`anchor === null` → ném). Tài khoản hết hạn/chưa kích hoạt gói gọi `getUsage` (hiển thị thanh dùng AI) nhận lỗi thay vì `state:'blocked'`. Hợp đồng `getUsage` không khai báo lỗi này. Đề xuất: `getUsage` bắt trường hợp không có mốc và trả `{percent:100,state:'blocked',nextCycleStartsAt:…}` hoặc contract nêu rõ lỗi. Dev: backend-dev.

### TRUNG BÌNH-2 – Lượt dự phòng tính tiền và gọi theo mô hình/giá của lượt chính
`gateway.service.ts:296` (`prov.complete(p.price.modelId, …)`), `:312` và `:490`/`:512` (`actualTokensCost(p.price, …)`). Giữ chỗ lượt dự phòng nay ghi đúng `provider/model/price_id` của tuyến rank 2, nhưng lời gọi gửi mã mô hình của lượt chính tới nhà cung cấp dự phòng và chi phí thực tính theo giá lượt chính. Sổ chi phí lệch hóa đơn nhà cung cấp (VIII, cảnh báo lệch > 5%), giữ chỗ ước tính cũng theo giá lượt chính. Nằm ở T049 nhưng nên chốt thiết kế ngay (giá, mô hình, ước tính theo từng lượt). Dev: backend-dev.

### TRUNG BÌNH-3 – `assertNoOuterTx` chỉ có ở kho thật, kho giả lặng lẽ cho qua
`db-budget-store.ts:111` so với `fake/store.memory.ts`, `fake/store.sandbox.ts` (không kiểm). Mã module khác chạy qua test với kho giả sẽ chỉ nổ khi bật driver real. Đề xuất: chuyển kiểm tra lên `AiGatewayService` (đầu `generate/generateStream/transcribe/system.generate`) hoặc thêm vào cả hai kho giả. Dev: backend-dev.

### THẤP-1 – Biên `<=` lệch với điều kiện reserve
`budget-store.ts:153,166`: `blocked` khi `cap − spent <= minEstimate`, nhưng reserve cho qua khi `used + reserved + est <= cap` (tức `est == cap − spent` vẫn được). Chỉ lệch khi `est == minEstimate` đúng bằng chỗ trống; nên dùng `<` cho chính xác. Dev: backend-dev.

### THẤP-2 – Giữ nguyên từ vòng 1 (THẤP-1): `held` dọn vẫn nhận cả `calling`
`db-budget-store.ts:716-717` → `releaseInTx` dùng `OPEN_STATES` (`:452,470`). Nếu giữ chỗ vừa chuyển `held→calling` giữa lúc đọc và trả, nó bị trả mà nhà cung cấp có thể đã tính tiền. Dev: backend-dev.

### THẤP-3 – `assertNoOuterTx` không phủ `releaseStale`, `usage`, `currentCycleStart`
`db-budget-store.ts:~655-680`. `usage`/`currentCycleStart` chỉ đọc nên lồng vẫn ổn. `releaseStale` mở nhiều giao dịch nên cũng không nên chạy trong giao dịch ngoài; cân nhắc thêm kiểm tra. Dev: backend-dev.

### THẤP-4 – Chú thích trùng ở `minCallEstimateMicro`
`db-budget-store.ts:119-123` có hai khối `/** */` liên tiếp (mô tả "không ném" nay sai vì lỗi tải CSDL vẫn ném). Gộp và sửa. Dev: backend-dev.

## (b) US2 – đối chiếu

| Hạng mục | Kết luận | Căn cứ |
|---|---|---|
| `tier.ts` | Đạt | `post_generation`/`topic_suggestion`: `used+reserved < softLimit ? default : cheap`; `image/video_labeling`→`cheap_vision`; `trend_summary`→`cheap`; STT→`stt`. Cùng tiêu chí `getUsage` `spent >= softLimit → cheap_model`. `softLimit` từ ảnh chụp CSDL (`ai_settings`), không hằng số |
| Hết ngân sách → `AI_BUDGET_EXHAUSTED`, không gọi nhà cung cấp | Đạt | `gateway.service.ts:259-265` ném trước `markCalling`/`provider`; `prepare` chỉ dùng `countInputTokens` (bộ ước tính cục bộ, không mạng, `token-estimate.ts`). Lưu ý bộ chuyển đổi real PHẢI dùng đúng hàm cục bộ này, không gọi API đếm token của nhà cung cấp trước giữ chỗ (III) |
| Không còn 2M/4M ngoài kho giả | Đạt | Chỉ còn `budget-store.ts:140-141` (dùng bởi `fake/store.memory.ts`, `fake/store.sandbox.ts`). `2_000_000` ở `config.schema.ts:223` là mặc định trần tuần hệ thống (cấu hình, đổi được) |
| `getUsage()` không trả tiền | Đạt | `gateway.service.ts:599` chỉ `percent`, `state`, `nextCycleStartsAt` |
| Bất bình thường III: reserve | Đạt | `db-budget-store.ts:269-283` một `UPDATE … WHERE used + reserved + est <= cap`; không đọc-rồi-ghi; hệ thống `:359-370` cùng khuôn |
| Dùng chung nguồn `minEstimate` | Đạt về cấu trúc | `isBudgetBlocked` (có reserved, hiển thị) và `isBudgetExhaustedSettled` (không reserved, cờ/thông báo) cùng nhận kết quả `minCallEstimateMicro()`; `getUsage` `:585-589` và `settleAccount:565`/`releaseStale:661` cùng một hàm. Giá trị của nó là vấn đề CAO-1 |
| Hiệu năng `minCallEstimateMicro` | Đạt | `RouteBook`/`DbPriceSource` đệm theo TTL (`route-book.ts:79`, `db-price-source.ts:104`; cấu hình `AI_PRICE_CACHE_TTL_MS` ≤ 60 s). Ở nhánh nóng chỉ `settle`/`getUsage` gọi; `reserve` không gọi nên kiểm ngân sách ≤ 50 ms không bị ảnh hưởng. Trường hợp trượt đệm thêm 2 truy vấn nhỏ mỗi TTL. `getUsage` mỗi lần ≈ 2–3 giao dịch (mốc chu kỳ, `usage`, và đọc lại mốc nếu chưa có dòng); chấp nhận được |
| Giá/tuyến cho `cheap`, `cheap_vision`, hệ thống | Đạt | Seed `0030:55-61` có rank 1–2 cho `default/cheap/cheap_vision`, `stt` rank 1; `trend_summary` đi bậc `cheap` |

## Ghi chú
- Bất biến III giữ nguyên ở kho thật: `reserve` một UPDATE có điều kiện; `settle` kẹp `used ≤ cap − reserved_sau`; `over_cap` ghi sổ.
- Vòng 1 đã nêu: `releaseStale` không còn rò khi `markCalling`/`stream()` lỗi (vì có `release` ngay); bộ dọn chỉ còn là lưới an toàn.
- Phạm vi sở hữu: các tệp xem xét thuộc `ai_gateway/**` (backend-dev); không thấy tệp ngoài phạm vi.
