# Kiểm thử US4 – bộ chuyển đổi nhà cung cấp thật (015)

## Đã làm

| Việc | Tệp | Kết quả |
| --- | --- | --- |
| Nới ca FR-025 Anthropic: không bịa cờ; kiểm KHÔNG có tiêu đề/trường `no-train/store/...`, `noTrain` (mặc định/true/false) nhận không lỗi, kết quả chuẩn hóa đúng. Hình dạng JSON giả khớp SDK 1.7 (đã chạy thật) | `apps/server/test/ai_gateway/providers.contract.spec.ts` | 51/51 đạt |
| T049c khóa AI: `allowedKeys` api/worker có `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (migrate-secrets không); `secretsInit` không tạo (kể cả chạy lại); `secretsSet` ghi được, đánh dấu external, không in giá trị; từ chối ở migrate-secrets (thoát 3) | `tooling/test/infra/secrets.spec.ts` | đạt |
| T049c: SECRET_VARS có khóa, NON_SECRET_VARS (ConfigMap) không; `base/configmap.yaml` + `config.env` hai overlay không đặt khóa (bỏ qua dòng chú thích) | `tooling/test/infra/handoff.spec.ts` | đạt (33/33 cùng secrets) |
| Quy tắc cảnh báo `AiProviderErrorRatioHigh`: biểu thức > 0.05 / [15m], `for: 5m`, `critical`, `sum by (provider)` cả tử/mẫu, `clamp_min`, chỉ chỉ số `ai_gateway_provider_calls_total` (khớp tên trong metrics.ts), không nhãn tài khoản/số tiền | `apps/server/test/unit/ai/alert-rules.spec.ts` | đạt |
| T049 dựng module `AI_GATEWAY_DRIVER=real` (CSDL thật, module dựng nhẹ): seed bật anthropic+openai; đủ hai khóa → dựng được, Worker có lịch `ai_gateway.release_stale_system` (API không thêm); thiếu một khóa → lỗi nêu đúng tên biến thiếu, không nêu biến đủ, không chứa khóa; thiếu cả hai → nêu cả hai | `apps/server/test/ai_gateway/real-driver-module.db.spec.ts` | 6/6 đạt |
| Prettier `ai-gateway.contract.ts` | - | đã sạch khi chạy lại (không cần sửa); các tệp mới đã format; eslint sạch |

## Điều tra ca đỏ môi trường

- `test:queue ai_gateway-release-stale` 3/5 đỏ "too many connections for role system": chạy riêng tệp 5/5 đạt; tệp đóng bể đúng (`afterAll` -> `database.close()`).
  Nguyên nhân gốc: `test/queue/readiness.queue.spec.ts` chạy `ALTER ROLE "system" CONNECTION LIMIT 0`. Vai trò là của CẢ cụm PostgreSQL nên mọi tiến trình khác dùng chung cụm (lượt kiểm thử song song, CSDL dev docker của người dùng) bị "too many connections for role system" trong lúc đó (và mãi mãi nếu lượt chạy bị kill giữa chừng). Đã sửa test: đặt `ALTER DATABASE <csdl_kiểm_thử> CONNECTION LIMIT 0/-1` (chỉ ảnh hưởng CSDL tạm; `asAdmin` là siêu quyền nên không bị chặn). `readiness.queue.spec.ts` 3/3 đạt sau sửa. Giới hạn vai trò hiện là -1 (không còn dính).
- `test/auth/meta-callbacks` 4/4 và `oauth-login` 12/12 đạt khi chạy riêng và khi chạy cùng nhau. Trong lượt chạy gộp `test/ai_gateway test/contracts/ai test/auth` (330 s, máy đang tải) có 3 ca oauth-login đỏ ("Không có thư tới ..." hết hạn đợi 3 s; `expected 400 to be 202`) – nghi môi trường (chờ thư bằng thời gian thực dưới tải / tương tranh với tiến trình khác), không liên quan Cổng AI; chưa tái hiện riêng lẻ.

## Kết quả chạy (TEST_DATABASE_ADMIN_URL = postgres cục bộ)

- `pnpm test` (apps/server, bộ nhớ): 68 tệp, 774 đạt, 1 expected fail, 24 bỏ qua, 0 hỏng.
- `test:db` `test/ai_gateway test/contracts/ai test/auth`: 36/38 tệp đạt; 450+ ca đạt; chỉ 3 ca oauth-login đỏ như trên, mọi ca ai_gateway / contracts/ai đạt.
- `tooling` vitest `secrets.spec.ts handoff.spec.ts`: 33/33.

## Bổ sung: ca kiểm cho các sửa của `reviews/us4.md` (mục 1–6)

| Mục | Ca kiểm | Tệp | Kết quả |
| --- | --- | --- | --- |
| 1 STT tên tệp | `audio.<đuôi>`: đuôi URL (thắng content-type), không phân biệt hoa/thường, chuỗi truy vấn không tính, rồi content-type (có tham số), mặc định mp3 (8 + 1 ca) | `test/ai_gateway/us4-stt-ssrf.spec.ts` | 29/29 đạt (cả tệp) |
| 2 SSRF | từ chối: host ngoài danh sách, trùng hậu tố, host kho ở vế trước, IP metadata, http, `user:pw@`, `file:`, chuỗi không phải URL (không tải, không POST, lỗi không chứa URL ký sẵn/khóa); danh sách rỗng từ chối; cho phép host đúng/tên miền con/viết hoa với `redirect:'error'`; 302 không bị theo; trần: đúng 2048 byte nhận, +1 từ chối (không content-length), 26 MB khai báo từ chối ở trần mặc định 25 MB; lỗi 404/refused/5xx và nhật ký không chứa chữ ký | cùng tệp | đạt |
| 2 (nối cấu hình) | host suy từ `S3_PUBLIC_ENDPOINT`, `S3_ENDPOINT` (+ tên miền con) và `AI_STT_ALLOWED_HOSTS` qua module `real`; không cấu hình gì → từ chối mọi URL; mọi lần tải có `redirect:'error'` | `test/ai_gateway/us4-module.db.spec.ts` | 6/6 đạt (cả tệp) |
| 3 hủy trước khi gọi | `generate` hủy từ trước (không giữ chỗ, không gọi, sạch); hủy ngay sau `markCalling` (released, không gọi, không dự phòng); `generateStream` `cancel()` trước reserve và ngay sau `markCalling` (không "ra ngoài", released, không sổ) – bản bộ nhớ và bản kho thật | `us4-gateway-abort-interrupt.spec.ts` (18 ca), `us4-gateway.db.spec.ts` (11 ca) | đạt |
| 4 luồng đứt | sau chữ + `partialUsage` (usage báo, output = max(báo, byte/3)); không usage (đầu vào 500 cục bộ, byte/3, kẹp đúng bằng giữ chỗ 1515 / 502); hết giờ tổng sau chữ; `interrupted=true`, dự phòng 0 lần, đúng MỘT dòng sổ `anomaly='missing_usage'` (dòng sổ thật trong DB); chưa có chữ (lỗi / quá hạn chữ đầu) → dự phòng đúng 1 lần, 2 giữ chỗ released+settled; cả hai lỗi → AI_PROVIDER_UNAVAILABLE 2 lời gọi; người dùng hủy giữa chừng giữ hành vi cũ (ký tự/4, 1 dòng sổ, không missing_usage); tầng bộ chuyển đổi Anthropic: đứt sau `message_start` có `partialUsage`, trước thì không | cùng hai tệp + `us4-anthropic-usage.spec.ts` (6 ca) | đạt |
| 5 giá bộ đệm | công thức: ví dụ tay 4185, ×1,25 ghi đệm, đọc đệm theo giá đệm, làm tròn lên (khớp công thức tham chiếu bigint, 100+ tổ hợp), kẹp ghi > (vào − đọc); ước tính không đổi (7500); sổ memory (4185/3960) và sổ DB thật (1095, ước tính 1300); ghi đệm toàn bộ vượt giữ chỗ → `over_estimate`, reserved = 0, ≤ trần; adapter Anthropic báo `cacheWriteInputTokens` riêng | `us4-cost-registry.spec.ts` (11), `us4-gateway-abort-interrupt.spec.ts`, `us4-gateway.db.spec.ts`, `us4-anthropic-usage.spec.ts` | đạt |
| 6 dựng lười | `buildAdapterIfKeyed`: có khóa → đúng loại; khóa của bên kia không mượn; thiếu khóa/lạ → `undefined`, không ném; `buildAdapters` nêu TÊN biến, không in khóa. Qua module `real` (tuyến anthropic, khởi động chỉ openai): lần gọi đầu dựng lười, gọi `api.anthropic.com` với `x-api-key`, settle; thiếu khóa/nhà cung cấp lạ → `AI_NOT_CONFIGURED` trước khi giữ chỗ, không gọi mạng, không in khóa; Cổng: lượt chính thiếu adapter → `AI_NOT_CONFIGURED`, lượt dự phòng thiếu → bỏ lượt (`AI_PROVIDER_UNAVAILABLE`) | `us4-cost-registry.spec.ts`, `us4-module.db.spec.ts`, `us4-gateway.db.spec.ts` | đạt |

Hạ tầng thêm: `test/ai_gateway/helpers/stub-adapter.ts` (nhà cung cấp giả viết tay + kho bọc ghi vết). `fetch` toàn cục bị thay bằng bản giả (`vi.spyOn`) ở các ca có host https – không có lời gọi mạng ngoài.

### Kết quả chạy lại (TEST_DATABASE_ADMIN_URL = postgres cục bộ)

- `pnpm test` (apps/server, bộ nhớ): 72 tệp, 838 đạt, 1 expected fail, 24 bỏ qua, 0 hỏng.
- `pnpm test:db test/ai_gateway test/contracts/ai`: 29/29 tệp, 409 đạt, 24 bỏ qua, 0 hỏng.
- `pnpm test:queue ai_gateway-release-stale`: 5/5 đạt.
- eslint + prettier + `tsc --noEmit` các tệp mới: sạch.

### Điểm lệch / lưu ý về mã sản xuất (không sửa mã, ghi để PM xử lý)

1. `src/modules/ai_gateway/internal/fake/store.memory.ts:252` – `settleLocked` ghi `anomaly: anomaly ?? (over ? 'over_estimate' : null)` NÊN bỏ mất `ledger.anomaly='missing_usage'` của bản nháp (kho DB thật thì lưu đúng). Hệ quả: ở kho bộ nhớ/driver `fake`, dòng sổ của luồng đứt không có `missing_usage`. Ca bộ nhớ kiểm ở lời gọi `settle` (qua kho bọc), ca DB kiểm cột thật. Mức: thấp (chỉ bản giả). Chủ: backend-dev.
2. Hệ số ghi đệm ×1,25 không có trong ước tính giữ chỗ (đã ghi trong tài liệu): lượt đầu ghi đệm gần như toàn bộ đầu vào có thể vượt giữ chỗ khoảng 4% khi biên an toàn token là 20% (1,25/1,2) → kẹp bởi trần, sổ `over_estimate`, cảnh báo `ai.cost_anomaly` (ca "ghi đệm toàn bộ vượt giữ chỗ" khóa hành vi này). Không phải lỗi; nên theo dõi ở POC-1.
3. Module `real` ở chế độ khởi động vẫn đòi khóa cho MỌI nhà cung cấp trong `enabledProviders()` (seed bật cả hai); dựng lười chỉ có hiệu lực cho nhà cung cấp bật SAU khởi động. Ca module dùng `AI_REAL_PARTS` ghi đè để mô phỏng tình huống này (không đổi bảng `model_routes` dùng chung). Đoạn closure `adapterFor` trong module không export nên chỉ kiểm được qua module đầy đủ như vậy.
4. Chưa kiểm được (cần nhà cung cấp thật/POC): OpenAI có thật sự nhận `audio.<đuôi>` (POC-4), hệ số 1,25 và tên trường usage của Anthropic thật (POC-1), hợp đồng không-huấn-luyện (R-17).

## Rủi ro / ghi chú

- Ca module `real` phụ thuộc seed migration 0030 (cả hai nhà cung cấp bật); nếu admin.db đổi tuyến mà không hoàn tác thì ca tiền đề đỏ.
- Hợp đồng không-huấn-luyện của Anthropic KHÔNG kiểm được bằng test tự động: cần ký/kiểm hợp đồng trước ngày ra mắt (R-17).
