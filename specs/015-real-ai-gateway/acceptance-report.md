# Báo cáo nghiệm thu — 015 Cổng AI thật

Ngày chạy: 2026-11-24 (UTC+7). Nhánh `impl/015-real-ai-gateway`. Người chạy: @qa. Quickstart mục 1–5 và 7 chạy đủ; mục 6 (nhà cung cấp thật, POC-1/POC-4) là thủ công, **không chạy** (xem cuối báo cáo).

CSDL: PostgreSQL cục bộ, `TEST_DATABASE_ADMIN_URL=postgres://postgres:…@localhost:5432/postgres` (mỗi lượt chạy tạo CSDL tạm riêng).

## 1. Kết luận

| Hạng mục | Kết quả |
|---|---|
| Mã sản xuất của 015 | Không phát hiện lỗi mã. Mọi ca đỏ còn lại đều có sẵn ở `dev` hoặc ngoài phạm vi 015 (mục 4) |
| Kiểm thử đơn vị (`@app/server`) | Lượt mới nhất sau T081: 77 tệp, 911 đạt, 1 expected-fail, 26 bỏ qua theo chủ đích (lượt `verify` cũ: 73 tệp, 867 đạt). Chi tiết mục 5a |
| `pnpm test:db` | 133 đạt + 1 bỏ qua (134 tệp), 1552 ca đạt; lượt `pnpm verify` sau khi thêm T075: 134 tệp, 1559 ca đạt |
| `pnpm test:queue` | 41 tệp, 232 ca đạt, 5 bỏ qua (chạy hai lần: đơn lẻ và trong `verify`, cùng kết quả) |
| `pnpm verify` | 13 bước đạt, 2 không áp dụng, 5 bước lỗi — cả 5 là lỗi có sẵn ở `dev` hoặc ngoài 015 (mục 4) |

## 2. Cổng tĩnh (quickstart mục 1, T070)

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | `apps/server`, `apps/web`, `packages/shared`, `e2e` đạt; chỉ `tooling/test/check-wiki.spec.ts(38,16)(41,38)` lỗi TS2339 (có sẵn ở `dev`) |
| `pnpm lint` | ESLint đạt sau khi sửa 2 lỗi `no-duplicate-type-constituents` ở `test/queue/ai_gateway-check-thresholds.queue.spec.ts` (tệp kiểm thử, do QA). Prettier còn 2 cảnh báo ở tệp **không bị 015 sửa**: `e2e/tests/media-upload.e2e.ts`, `infra/docs/p6-cau-hoi-nha-cung-cap.md` (có sẵn) |
| `pnpm check:boundaries` | Đạt: 759 module, 3087 phụ thuộc, 0 vi phạm; `no-cross-schema-sql` đạt |
| `pnpm db:lint-migrations` | Đạt, 5 tệp, 0 vi phạm |
| `pnpm db:check` | Đạt, 12 schema, 50 bảng, 5 khung nhìn, 0 vi phạm |
| `pnpm check:secrets` | Đạt (1983 tệp); `check:secrets:test-logs` đạt (235 tệp nhật ký mẫu, gồm tệp của T075 có khóa mẫu) |
| `ai_gateway` chỉ nhập module khác qua `account`, `queue`, `notifications` | Xác nhận bằng Grep: các import ra ngoài module chỉ là `../account`, `../queue`, `../notifications` (kèm `core`/`dev` dùng chung) |
| SDK nhà cung cấp chỉ ở `internal/providers/` | Xác nhận bằng Grep: `@anthropic-ai/sdk` chỉ ở `providers/anthropic.ts`, `openai` chỉ ở `providers/openai.ts` (ngoài ra chỉ là `package.json`, `modules.manifest.json` và một regex kiểm thử) |

## 3. Quickstart mục 2–5 và 7: kịch bản, lệnh, kết quả

Tất cả chạy trong `apps/server` với `TEST_DATABASE_ADMIN_URL` đã đặt. Lệnh dưới đây tương đương `pnpm test:db -- <đường dẫn>` của quickstart (dùng `vitest run --config vitest.db.config.mts <đường dẫn>` để lọc tệp).

| Mục | Lệnh đã chạy | Kết quả | Tiêu chí liên quan |
|---|---|---|---|
| 2 hợp đồng + đồng thời | `vitest run --config vitest.db.config.mts test/contracts/ai` | 2 tệp (db + sandbox), 83 đạt, 27 bỏ qua theo chủ đích (ca chỉ áp dụng cho chế độ khác, vd `ctx.skip()` khi `db`/`supportsRequestId` không có) | SC-001, SC-002, SC-003, SC-005, SC-006, SC-007 |
| 2 (tiếp) 100 vòng × 25 lời gọi sát trần, p95 reserve | `test/ai_gateway/concurrency.db.spec.ts` (nằm trong bộ `test:db` đầy đủ, đạt) | Đạt: `used + reserved ≤ cap` mọi lần quan sát, `reserved = 0`; 200 giữ chỗ → đúng 100 thành công | SC-001, SC-002, SC-003 |
| 3 idempotency + chu kỳ | `test/ai_gateway/request-id test/ai_gateway/cycle test/ai_gateway/idempotent test/ai_gateway/us1` | 4 tệp, 34 đạt. Ngày kích hoạt 29/30/31, tháng 2, hai yêu cầu đầu chu kỳ đồng thời, `requestId` trùng nằm trong bộ hợp đồng + `cycle.spec.ts` + `idempotent-close` + `us1-*` | FR-014, FR-037a, SC-010, SC-011 |
| 3 (hàng chờ) | `vitest run --config vitest.queue.config.mts test/queue/ai_gateway-release-stale` | 2 tệp, 10 đạt (giữ chỗ treo 16 phút được xử lý; chạy dọn hai lần = một lần) | SC-010 |
| 3 (hàng chờ, ngưỡng) | `test/queue/ai_gateway-check-thresholds.queue.spec.ts` (trong `pnpm test:queue`, đạt) | Đạt; chạy hai lần cùng kết quả | FR-038, SC-011 |
| 4 dự phòng, STT, hệ thống | `test/ai_gateway/fallback test/ai_gateway/stt test/ai_gateway/system-budget` | 3 tệp, 31 đạt | SC-008, SC-009, FR-024/024a, FR-021, FR-032/032a/033 |
| 5 quyền, kiểm toán, không lộ tiền, cô lập | `test/ai_gateway/admin test/ai_gateway/rls-cross-account test/ai_gateway/no-money` | 3 tệp, 70 đạt | SC-004, FR-010, FR-019a, FR-029, FR-035; hiến chương I |
| 7 hồi quy bản giả: bộ nhớ | `pnpm --filter @app/server test` (`AI_GATEWAY_DRIVER=fake`, chế độ bộ nhớ) | 73 tệp, 867 đạt, 1 expected-fail, 26 bỏ qua | FR-028 |
| 7 hồi quy bản giả: sandbox + CSDL | `pnpm test:db` toàn bộ | 134 tệp, 1552 đạt (ca hợp đồng chạy ở cả `sandbox` và `db`) | FR-028 |
| 7 production từ chối bản giả | `test/unit/gateway-selection.spec.ts` + `test/config.spec.ts` (`AI_GATEWAY_DRIVER=fake` ở production/staging bị `assertNoFakesInProduction` từ chối, thông điệp nêu tên biến) | Đạt trong `pnpm test` | FR-028 |
| Bộ xử lý nền mới chạy hai lần | `test/queue/ai_gateway-release-stale*.queue.spec.ts`, `ai_gateway-check-thresholds`, `ai_gateway-reconcile` (nếu có) trong `pnpm test:queue` | Đạt, mỗi bộ chạy lại cho cùng kết quả | hiến chương V |

## 4. Hồi quy bảo mật và hiệu năng (T075)

Tệp: `apps/server/test/ai_gateway/security-perf-regression.db.spec.ts` (7 ca, đạt trong chạy riêng và trong `verify`). Ở các ca (A) bộ chuyển đổi Anthropic/OpenAI **thật** chạy với khóa mẫu `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` tới máy chủ HTTP giả cục bộ, máy chủ cố tình in lại khóa và lời nhắc trong thân lỗi 401.

| Ca | Nội dung | Kết quả |
|---|---|---|
| A1 | Cả hai nhà cung cấp 401 → `AI_PROVIDER_UNAVAILABLE`; khóa không có trong thông điệp/ngăn xếp/JSON của `AiError` và `ProviderCallError`, trong sổ/giữ chỗ/ngân sách (đọc bằng owner); ngân sách không bị trừ | Đạt |
| A2 | Lời gọi thành công: sổ đúng 1 dòng, không khóa, không lời nhắc, không văn bản kết quả | Đạt |
| A3 | Thông báo ngưỡng (nếu phát) không chứa khóa | Đạt |
| A4 | Chỉ số OpenTelemetry (đọc bằng bộ đọc bộ nhớ): không khóa/lời nhắc; `ai_gateway_provider_calls_total`, `ai_gateway_events_total` không nhãn `account_id`, không nhãn tiền | Đạt |
| A5 | Nhật ký thao tác (log-capture) không khóa, lời nhắc, văn bản kết quả | Đạt |
| B | `reserve` p95 ≤ 50 ms, 200 lần trên CSDL thật (có khởi động nóng 5 lần) — SC-003 | Đạt |
| C | 20 vòng × 12 giữ chỗ đầu chu kỳ ở 3 tài khoản mới chạy chồng nhau (36 giữ chỗ/vòng, tổng 720): 0 từ chối sai, `reserved` khớp rồi về 0 — kiểm chứng bản sửa race ở `db-budget-store.reserveAccount` | Đạt (0 từ chối nhầm) |

Ca bổ trợ đã có từ trước: `first-reserve-race.db.spec.ts` (80 vòng × 12), `concurrency.db.spec.ts` ca p95. Cả ba đạt ổn định ở mọi lượt chạy.

## 5. Cảnh báo vận hành (T050/T069, SC-013)

`apps/server/test/unit/ai/alert-rules.spec.ts` (20 ca, đạt) khớp `ops/alerts/ai_gateway.rules.yml` 10 quy tắc: tên, mức độ, `for`, cửa sổ, chỉ số, nhãn `event` thuộc `GatewayEventName`, tên chỉ số khớp `metrics.ts` (`_sum/_count` của histogram ánh xạ về `ai_gateway_estimate_ratio`), mô tả tiếng Việt, không `account_id`/micro/usd.

Giá trị `for` / cửa sổ theo quy tắc cuối cùng (đã cập nhật kỳ vọng, SC-013 theo plan):

| Quy tắc | Mức | `for` | Cửa sổ |
|---|---|---|---|
| `AiProviderErrorRatioHigh` | critical | 5m | 15m |
| `AiSystemBudgetExhausted` | warning | 5m | 15m |
| `AiOpenReservationsStuck` | warning | 5m | 30m |
| `AiCostAboveEstimate` | warning | 30m | 1h |
| `AiThresholdRatioHigh` | warning | 0m | 10m |
| `AiInvoiceMismatch` | warning | 0m | 24h |
| `AiSettleFailed`, `AiPriceMissing`, `AiRouteMissing` | critical | 0m | 10m |
| `AiIndustrySourceMissing` | warning | 5m | 1h |

Hai bất biến SC-013 được kiểm: (1) mọi quy tắc theo sự kiện rời rạc (`sum(increase(ai_gateway_events_total{event=…}[W])) > 0`) có `for` < W, nếu không cảnh báo kẹt ở pending; (2) nhóm critical rời rạc (`AiSettleFailed`, `AiPriceMissing`, `AiRouteMissing`) có `for` + cửa sổ + 1 phút chu kỳ đánh giá ≤ 15 phút; `AiProviderErrorRatioHigh` là quy tắc theo tỷ lệ nên kiểm riêng (`for` 5m, cửa sổ 15m). Việc `ai_gateway.check_thresholds` chạy mỗi 5 phút (`*/5 * * * *`), kiểm ở `test/queue/ai_gateway-check-thresholds.queue.spec.ts`; ngân sách `AiThresholdRatioHigh` = 0 + 10 + 1 ≈ 11 phút ≤ 15. Ghi chú: chưa có `promtool` trong repo nên SC-013 kiểm bằng cấu hình, không chạy mô phỏng Prometheus thật (xem mục 8, "chờ điều kiện ngoài").

## 5a. Kiểm thử bổ sung T081 / T057

| Nội dung | Tệp | Kết quả |
|---|---|---|
| SC-014 (a) tĩnh: `publishing`, `approval`, `platform_gateway`, `account`, `notifications`, `queue` không có `ai_gateway` trong `allowedDeps` và không import; `content`, `media`, `context`, `trends` chỉ tệp AI riêng (tên có "ai") mới import; tệp tải lên/gắn nhãn tay của `media` không chạm Cổng AI | `test/ai_gateway/blocked-manual-ok.spec.ts` | Đạt |
| SC-014 (b) ngân sách hết: lời gọi AI bị chặn trước khi gọi nhà cung cấp (`AI_BUDGET_EXHAUSTED`, không giữ chỗ, không sổ), `getUsage` đọc được (`blocked`, 100%, chỉ `percent/state/nextCycleStartsAt`), tài khoản khác không bị ảnh hưởng | cùng tệp | Đạt |
| FR-031 (c): `messageVi` của `AI_BUDGET_EXHAUSTED` không số tiền (chuỗi này cố định theo hợp đồng 005); lối tiếp tục thủ công nằm ở thông báo `ai_usage_100`/`ai_usage_80` (nêu rõ vẫn soạn tay, duyệt, lên lịch, đăng; có hành động mở mức dùng; không tiền) và ở giao diện | cùng tệp; web `lib/limits/limits.spec.tsx` ("soạn tay vẫn dùng được", lý do chứa "Bạn vẫn soạn tay"), `ui/cards/cards.spec.tsx` (nhãn chữ + biểu tượng, 18 ca web đạt) | Đạt |
| FR-036 đầu-cuối ở bộ nhớ: `opts.traceId` của bộ chuyển đổi = `ai_cost_ledger.traceId` = `AiResult.traceId`; có `traceId` yêu cầu thì giữ (thắng mã ngữ cảnh); không có thì lấy mã ngữ cảnh việc/yêu cầu; lượt dự phòng mang cùng mã; mã không lọt vào lời nhắc; `generate` và `generateStream` | `test/ai_gateway/fr036-trace.spec.ts` (6 ca) | Đạt |
| FR-036 trên kho thật: cột `ai_gateway.ai_cost_ledger.trace_id` khớp `opts` và kết quả | `test/ai_gateway/fr036-trace.db.spec.ts` (2 ca) | Đạt |
| FR-037 `noRetryOnAiError`: `AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`, `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED` → `no_retry` (lý do chỉ là mã); `AI_PROVIDER_UNAVAILABLE`, `AI_INVALID_REQUEST`, lỗi lạ → ném lại để hàng chờ thử lại | `test/ai_gateway/nonretry-and-aborted.spec.ts` | Đạt |
| Outcome `aborted`: hủy từ trước, hủy giữa chừng, lỗi SDK `AbortError`/`APIUserAbortError` đều ghi `outcome="aborted"`, KHÔNG `error`, KHÔNG phát `ai.provider_error`; đối chứng lỗi 503 vẫn là `error` và phát `ai.provider_error` | cùng tệp | Đạt |

Hỗ trợ: `test/ai_gateway/helpers/stub-adapter.ts` thêm `receivedOpts` (ghi `opts` mà Cổng truyền cho `complete`/`stream`).

Số liệu lượt chạy mới nhất (2026-11-24, sau T081):

| Lệnh | Kết quả |
|---|---|
| `pnpm test` (`@app/server`, bộ nhớ) | 77 tệp, 911 đạt, 1 expected-fail, 26 bỏ qua theo chủ đích |
| `pnpm test:db` lọc `test/ai_gateway test/contracts/ai` | 44 tệp, 610 đạt, 27 bỏ qua theo chủ đích (không chạy cả bộ `test:db` ở lượt này) |
| `pnpm test:queue` lọc `ai_gateway` | 4 tệp, 23 đạt |
| web `limits.spec.tsx` + `cards.spec.tsx` | 2 tệp, 18 đạt |
| eslint + prettier tệp mới/sửa | Đạt |

## 6. `pnpm verify` — lỗi không thuộc 015 (tách riêng)

Chạy: `pnpm verify` (~1192 s). Đạt: build:shared, check:boundaries, check:web-rules, check:secrets, check:pipeline, check:web-bundle, db:lint-migrations, db:immutable, test:db, test:queue, check:secrets:test-logs, test:e2e, check:image. Không áp dụng: check:release-source (đích không phải master), db:compat (không có migration mới).

| Bước lỗi | Nguyên nhân | Thuộc |
|---|---|---|
| `typecheck` | `tooling/test/check-wiki.spec.ts(38,16)(41,38)` TS2339 | Có sẵn ở `dev` (đã biết) |
| `test` | `tooling/test/infra/power.spec.ts`: `Cannot find module './kubeconfig.mjs'` từ `tooling/infra/commands/power.mjs:12` (`pnpm -r test` dừng ở tooling, nên server/web phải chạy riêng: đều đạt) | Có sẵn ở `dev` (đã biết) |
| `infra:check` | Cùng `power.spec.ts` (vitest tooling/test/infra: 1 lỗi / 16 đạt) | Có sẵn ở `dev` |
| `lint` | Prettier: `e2e/tests/media-upload.e2e.ts`, `infra/docs/p6-cau-hoi-nha-cung-cap.md` (015 không sửa hai tệp này, `git diff` rỗng) | Có sẵn ở `dev` |
| `test:web-e2e` | `apps/web/e2e/shell-roles.spec.ts:13` mong 7 liên kết điều hướng ở 1280 px, thấy 6; nhật ký máy chủ cùng lượt ghi `TypeError … countScheduledByConnections` ở `publishing.module.ts:40` (GET `/channels/overview`). 015 chỉ sửa `UsageMeter.tsx`/`cards.spec.tsx` ở web, không đụng điều hướng/Kênh | Không thuộc 015 (nghi 010/publishing hoặc nhánh đang lệch `dev`); cần PM giao dev-web/backend xem |

Ca chập chờn đã biết (`meta-callbacks`, `oauth-login e2e`) không đỏ trong cả hai lượt `test:db` và lượt trong `verify`.

## 7. Truy vết tiêu chí → kiểm thử

| Tiêu chí | Kiểm thử chính | Kết quả |
|---|---|---|
| US1/SC-001/002 chặn trước trần | `contracts/ai` (mục đồng thời), `concurrency.db.spec.ts`, `first-reserve-race`, `us1-*`, `security-perf-regression` (C) | Đạt |
| SC-003 p95 ≤ 50 ms | `ai.db.contract.spec.ts` mục 14, `concurrency.db.spec.ts`, `security-perf-regression` (B) | Đạt |
| US2/SC-005 ngưỡng 2 USD | `tier-threshold.db.spec.ts`, `tier-threshold.spec.ts`, `tier-snapshot.db.spec.ts`, hợp đồng | Đạt |
| US3/SC-006/007 sổ + giá | `ledger-reconcile.spec.ts`, `price-effective.spec.ts`, `admin.db.spec.ts`, hợp đồng mục 15–20 | Đạt |
| US4/SC-008 dự phòng | `fallback.db.spec.ts`, `us4-gateway*.spec.ts`, `providers.contract.spec.ts` | Đạt |
| US5/SC-009 STT | `stt.db.spec.ts`, `us4-stt-ssrf.spec.ts` | Đạt |
| US6/SC-004/011 % + thông báo + không tiền | `no-money.spec.ts`, `threshold-notify.db.spec.ts`, `rls-cross-account.db.spec.ts` | Đạt |
| US7 ngân sách hệ thống | `system-budget.db.spec.ts`, `allocation*.db.spec.ts`, `trend-allocations-isolation.db.spec.ts` | Đạt |
| US8/SC-013 cảnh báo + đối soát | `alert-rules.spec.ts`, `alerts.db.spec.ts`, `ledger-reconcile.spec.ts`, `ai_gateway-check-thresholds.queue.spec.ts` | Đạt (SC-013 chưa chạy qua `promtool`) |
| SC-010 giữ chỗ treo | `ai_gateway-release-stale*.queue.spec.ts` | Đạt |
| FR-026 khóa không lộ | `security-perf-regression` (A), `providers.contract.spec.ts` | Đạt |
| SC-013 cảnh báo ≤ 15 phút | `alert-rules.spec.ts` (bất biến `for` < cửa sổ; critical rời rạc for + cửa sổ + 1 ≤ 15), `ai_gateway-check-thresholds.queue.spec.ts` (`*/5 * * * *`) | Đạt ở mức cấu hình; chưa qua `promtool`/Prometheus thật |
| SC-014 vẫn làm tay khi AI bị chặn | `blocked-manual-ok.spec.ts` (đường thủ công không đi qua Cổng AI; AI bị chặn chỉ ở lời gọi AI; thông báo nêu lối thủ công), web `limits.spec.tsx`, `cards.spec.tsx` | Đạt phần tự động; thao tác đầu-cuối trên giao diện vẫn thử thủ công (mục 8) |
| FR-036 mã theo dõi | `fr036-trace.spec.ts`, `fr036-trace.db.spec.ts` | Đạt |
| FR-037 không thử lại khi hết hạn mức | `nonretry-and-aborted.spec.ts` | Đạt |

## 8. Chờ điều kiện ngoài và việc thử thủ công

Chờ điều kiện ngoài (không thuộc phạm vi tự động hóa của @qa, chưa đóng):

- **T049a, T073a**: việc của PM/architect (ghi kết quả đo vào `research.md`).
- **POC-1, POC-4** (chọn mô hình AI và STT): cần nhà cung cấp thật.
- **SC-012 và SC-008 với nhà cung cấp thật**: cần khóa thật (xem dưới).
- **`promtool test rules` cho SC-013**: repo chưa có `promtool`; hiện chỉ kiểm cấu hình bằng `alert-rules.spec.ts`.

- **SC-012 (chi phí trung bình ≤ 2 USD/tài khoản, 0 tài khoản > 4 USD) và SC-008 với nhà cung cấp thật**: cần khóa thật. Làm theo quickstart mục 6: đặt `AI_GATEWAY_DRIVER=real`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, nạp giá bằng `POST /admin/ai/prices`, tạo 1 bài rồi xem sổ; ghi kết quả đo vào `research.md` mục "Kết quả đo" (T073a, @pm/architect). **Chưa chạy.**
- **SC-014 (đầu-cuối giao diện)**: chặn AI của một tài khoản thử (đặt `used` = 4 USD qua công cụ quản trị) rồi thử soạn tay, duyệt, lên lịch, đăng, tải media, gắn nhãn tay trên giao diện; mọi thao tác phải hoàn thành.
- **SC-013 với Prometheus thật**: nạp `ops/alerts/ai_gateway.rules.yml` vào Prometheus staging, tăng bộ đếm `ai_gateway_events_total{event="ai.settle_failed"}` rồi xác nhận Alertmanager gửi kênh nhận trong ≤ 15 phút.
