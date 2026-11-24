# Rà soát US4 (T044–T050, T045a/b, T048a, T049b, T049c) + vòng 2 US3 – 015 Cổng AI thật

Phạm vi: `internal/providers/{anthropic,openai,provider-error,registry,provider,token-estimate}.ts`, `internal/gateway.service.ts`, `ai_gateway.module.ts`,
`internal/budget/db-budget-store.ts` (`attemptRoute`, `reserve`, `markCalling`, `release`, `settle`), `internal/metrics.ts`, `core/gateways/op-log.ts`,
cấu hình/hạ tầng (`config.schema.ts`, `handoff-map.mjs`, `infra/docs/06`, `overlays/*/config.env`, `ops/alerts/ai_gateway.rules.yml`),
và migration 0030/0031 + `internal/admin/*` sau chỉnh sửa. Thay đổi chưa commit (working tree) nên đối chiếu trực tiếp tệp.

Kiểm tra tĩnh: `pnpm check:boundaries` đạt (752 module, không vi phạm; SDK chỉ nhập trong `providers/`); `pnpm check:secrets` đạt;
`pnpm typecheck` chỉ lỗi cũ `tooling/test/check-wiki.spec.ts(38,41)` (ngoài 015); `pnpm lint`: eslint đạt, prettier cảnh báo
`infra/docs/06-bi-mat-va-khoa.md` (015) và 2 tệp ngoài phạm vi. Chạy `vitest` providers.contract + token-estimate + unit/ai: 76/76 đạt.

## Tuân thủ hiến chương (US4)
- I: đạt. Không nhận `accountId` từ người gọi; giữ chỗ/quyết toán qua `tenantTx`/`systemTx`; không gửi mã tài khoản, email, số điện thoại ra nhà cung cấp (chỉ `x-trace-id`).
- II: không ảnh hưởng luồng đăng bài (Cổng AI độc lập). Đạt.
- III: đạt về trình tự. `reserve` (một câu UPDATE có điều kiện, CHECK ở bảng) → `markCalling` → gọi → `settle`/`release`; đếm token cục bộ
  (`LocalTokenCounter`, `estimateInputTokens` bigint, làm tròn lên), KHÔNG gọi API nhà cung cấp trước giữ chỗ; mỗi lượt có giữ chỗ riêng, lượt chính `release` trước khi giữ lượt dự phòng;
  tối đa 2 lượt (`MAX_ATTEMPTS`); loại việc chưa bật dự phòng → `attemptRoute` trả `null` → `AI_PROVIDER_UNAVAILABLE` ngay; thiếu giá lượt dự phòng → bỏ lượt + `ai.price_missing`.
  Không số tiền trong `AiResult`, chỉ số, nhật ký, sự kiện (kiểu `GatewayEventFields` không có trường tiền). Đạt.
- IV: đạt. `anthropic`/`openai` SDK chỉ ở `providers/`; kiểu SDK không ra ngoài; thêm nhà cung cấp = một dòng trong `ADAPTER_FACTORIES`.
- V: đạt. `release`/`settle` là `UPDATE … WHERE state IN ('held','calling')` và chỉ khi trúng dòng mới đổi ngân sách/ghi sổ; chạy lại không tác dụng phụ; `releaseStale` dọn giữ chỗ treo.
- VII: đạt có lưu ý. Khóa chỉ nằm trong closure của client SDK; `ProviderCallError` chỉ gồm nhà cung cấp + loại + mã HTTP, không giữ `cause`;
  `ai.provider_error` chỉ `provider/kind/status` (đều trong `SAFE_ATTR_KEYS`); `buildAdapters` chỉ in TÊN biến; không cho cấu hình `baseURL`; khóa ở Secret `api-secrets`/`worker-secrets`,
  không ở ConfigMap/`config.env` (có test `handoff.spec.ts`). OpenAI `store:false` mặc định; Anthropic không có cờ kỹ thuật (cam kết hợp đồng – đã ghi nhận). Xem mục 2, 7 về gửi ra ngoài.
- VIII: đạt. `traceId` (yêu cầu → ngữ cảnh → span → mới) đi vào tiêu đề `x-trace-id` đã lọc ký tự, ghi sổ, không vào lời nhắc.

## Phát hiện US4

### CAO
1. `apps/server/src/modules/ai_gateway/internal/providers/openai.ts:163` – `toFile(await audio.arrayBuffer(), 'audio')` đặt tên tệp KHÔNG có đuôi; điểm cuối `/audio/transcriptions` của OpenAI xác định định dạng theo đuôi tên tệp
   (mp3/mp4/m4a/wav/webm…) nên có khả năng cao trả 400 "định dạng không nhận ra" ở mọi lời gọi STT thật (máy chủ giả ở test không bắt được; không có dự phòng cho `transcription`). Đề xuất: suy đuôi từ `content-type`/đường dẫn `audioUrl` (mặc định `.mp3`) và thêm test kiểm tên tệp trong phần multipart; xác nhận bằng POC-4. Chủ: backend-dev (test: qa).

### TRUNG BÌNH
2. `openai.ts:159-163` – `fetch(audioUrl)` chỉ kiểm `^https?://`: không giới hạn host (SSRF tới địa chỉ nội bộ/metadata), tự theo chuyển hướng, `arrayBuffer()` nạp toàn bộ tệp vào bộ nhớ không trần. `audioUrl` do module gọi truyền vào nhưng Cổng là lớp cuối trước nhà cung cấp (hiến chương I: tiền tố `tenants/{mã}/`, VII). Đề xuất: `redirect: 'error'`, chỉ cho host của kho tệp S3 cấu hình, trần `Content-Length`/số byte đọc (≤ giới hạn tệp của OpenAI), từ chối khi vượt. Chủ: backend-dev.
3. `gateway.service.ts:352-363` (`withTimeout`) và `:713-717` (`generateStream`) – `outer.addEventListener('abort')` không bắn nếu tín hiệu ĐÃ hủy trước đó: lời gọi vẫn đi tới nhà cung cấp (và phát sinh chi phí) dù bên gọi đã hủy; với luồng, `cancel()` trước/trong lúc `reserve` cũng bị bỏ qua tương tự. Đề xuất: kiểm `signal?.aborted`/`controller.signal.aborted` trước `reserve` và ngay sau `markCalling` → `release` + trả (`AI_PROVIDER_UNAVAILABLE` hoặc kết quả rỗng như nhánh hủy hiện có). Chủ: backend-dev.
4. `gateway.service.ts:769-795` – luồng đứt do LỖI nhà cung cấp (không phải hủy) sau khi đã có chữ vẫn trả bản cắt như thành công (không báo lỗi, không dự phòng); và quyết toán phần đã sinh dùng `ceil(received.length / 4)` (:772) thay vì dùng `usage` thực nhà cung cấp đã báo ở `message_start`/`include_usage` (mất vì bị ném). Tiếng Việt có dấu nhiều token/ký tự hơn → ghi sổ thấp hơn thực, kéo lệch hóa đơn (> 5% là cảnh báo VIII). Đề xuất: bộ chuyển đổi gắn `partialUsage` vào `ProviderCallError`, hoặc dùng ước tính chặn trên theo byte/3 như `estimateInputTokens`; và dùng outcome `partial_error` để theo dõi. Chủ: backend-dev.
5. `providers/anthropic.ts:98` + `estimate.ts:27-37` – `cache_creation_input_tokens` được cộng vào `inputTokens` và tính giá đầu vào thường, trong khi Anthropic tính ghi bộ đệm đắt hơn (≈ 1,25×); `cache_control` luôn gắn vào tiền tố cuối, nên lượt đầu của mỗi tiền tố bị ghi sổ thấp hơn hóa đơn (và vượt ước tính giữ chỗ → `ai.cost_anomaly`, được kẹp bởi trần nên không phá bất biến). Đề xuất: ghi nhận vào R-09/POC-1 và hoặc thêm cột/hệ số giá ghi đệm, hoặc nhân hệ số khi đối chiếu; ít nhất ghi rủi ro vào `docs/ai-gateway-providers.md`. Chủ: backend-dev (giá: data-dev).
6. `ai_gateway.module.ts:167-172` + `admin/routes.service.ts:26-38` – bộ chuyển đổi chỉ dựng MỘT LẦN lúc khởi động từ `enabledProviders()` (ảnh chụp). Admin bật/đổi tuyến sang nhà cung cấp chưa dựng (hoặc đặt `stt` cho `anthropic` vốn `unsupported`) thì mọi lời gọi bậc đó trả `AI_NOT_CONFIGURED` cho tới khi khởi động lại; không có kiểm tra ở `setRoute` và `ai-gateway-providers.md` không nêu yêu cầu khởi động lại. Đề xuất: `setRoute` từ chối khi nhà cung cấp ngoài tập đã dựng hoặc không hỗ trợ thao tác (stt ≠ openai), và ghi rõ quy trình (đặt khóa → rollout restart) trong tài liệu. Chủ: backend-dev.

### THẤP
7. `gateway.service.ts:106-108` – `validateAiRequest` không kiểm `images[].bytes` hay giao thức URL; `IMAGE_INPUT_TOKENS = 800` cố định chỉ đúng với khung hình thu nhỏ. Ảnh gốc lớn (hoặc `http://`) vẫn được gửi ra ngoài và vượt ước tính. Đề xuất: chỉ `https`, `bytes` ≤ trần (vd 512 KB) → `AI_INVALID_REQUEST`. Chủ: backend-dev.
8. `provider-error.ts:70-90` + `ops/alerts/ai_gateway.rules.yml:15-18` – hủy do người dùng (`aborted`) tính là `outcome="error"` và sinh `ai.provider_error`, làm nhiễu cảnh báo > 5%/15 phút; biểu thức không có ngưỡng khối lượng tối thiểu nên 1/3 lời gọi lỗi cũng kích hoạt `critical`. Đề xuất: ghi `aborted` thành outcome riêng, và thêm `and sum by (provider)(increase(...[15m])) >= 20` vào `expr`. Chủ: backend-dev (metrics), devops-dev (quy tắc).
9. `gateway.service.ts:476-479` và `db-budget-store.ts:498-508` – `catch {}` bỏ mọi lỗi (kể cả lỗi lập trình, `release` ném lỗi DB thô thay vì `AiError`); `markCalling` không kiểm số dòng bị đổi: nếu giữ chỗ đã bị dọn (`released`) thì vẫn gọi nhà cung cấp không còn giữ chỗ (khe rất hẹp, chỉ khi quá 15 phút). Đề xuất: `markCalling` trả `boolean` và `false` → không gọi; bọc `release` lỗi thành `AI_PROVIDER_UNAVAILABLE` kèm cảnh báo. Chủ: backend-dev.
10. `infra/docs/06-bi-mat-va-khoa.md` – prettier `--check` không đạt (cột bảng lệch). Đề xuất: `prettier --write`. Chủ: devops-dev.

## Vòng 2 US3 (data-dev, backend-dev) – đối chiếu với `reviews/us3.md`
Đã khắc phục: mục 1–3 (kiểm 10× dưới khóa tư vấn, so với dòng liền trước VÀ liền sau, TTL 60 s theo đồng hồ CSDL, tất cả trong `admin_add_price` 0031:89-134); mục 4 (NULL tier/rank/task → RAISE); mục 5 (`rank2?.enabled`); mục 6 (đơn vị suy từ bậc, kiểm cả ở SQL :248-253); mục 7 (GRANT chỉ `support`); mục 8 (`p_id` NULL → RAISE ở `admin_write_audit`); mục 9 (0030:8-9 thu INSERT `model_prices` cả `app` lẫn `system`); mục 10 (prettier của contract hết cảnh báo).
Còn lại (THẤP):
11. `0030_ai_gateway_seed_support.sql:7,11,26` – chú thích lỗi thời ("qua owner", "model_routes (system, có audit_log)"); ghi đã chuyển sang hàm 0031. Chủ: data-dev.
12. `admin/pricing.service.ts:47-52` + `db/admin-functions.ts` (`getCurrentPrice`) – kiểm TTL ở TS trùng với SQL nhưng dùng đồng hồ API (lệch đồng hồ có thể từ chối giá hợp lệ; SQL mới là nguồn tin cậy); `getCurrentPrice` không còn nơi dùng (mã chết). Đề xuất: bỏ kiểm TS (giữ ánh xạ lỗi) và xóa hàm không dùng. Chủ: backend-dev.
13. `0031…sql:37-50,304-310` – `p_price_id`/`p_id` NULL dẫn tới `23502` không ánh xạ (500 thay vì 422); chỉ `p_audit_id` được kiểm. TS luôn truyền UUID v7 nên chỉ là lớp phòng thủ. Đề xuất: thêm vào điều kiện đầu hàm. Chủ: data-dev.
Hạ tầng: Secret chứa khóa đúng (api/worker-secrets, không ConfigMap, test T049c); production overlay chỉ ghi chú, không đặt khóa; `assert-no-fakes` vẫn từ chối `fake` ở production; cảnh báo lỗi nhà cung cấp có (xem mục 8). `open_reservations` gauge chưa nối (đã chốt để T066). Khóa `AI_GATEWAY_DRIVER=real` cần cả hai khóa vì seed bật cả hai (đã chốt).

## Kết luận
cần-sửa: 0 nghiêm trọng, 1 cao, 5 trung bình, 7 thấp. Nên sửa mục 1 (STT không chạy thật), 2, 3 trước khi bật `AI_GATEWAY_DRIVER=real`; mục 4–6 trước POC-1/POC-4 chốt giá.
