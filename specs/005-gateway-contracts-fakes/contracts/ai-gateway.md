# Hợp đồng – Cổng AI (`ai_gateway`)

Lối vào duy nhất: `apps/server/src/modules/ai_gateway/index.ts`. Kiểu dữ liệu: [data-model.md](../data-model.md)
mục 2. Module được gọi (manifest): `context`, `media`, `trends`, `content`. SDK nhà cung cấp chỉ được nhập trong
`ai_gateway/internal/providers/` (quy tắc có từ 001).

## 1. Giao diện công khai (token `AI_GATEWAY`)

```ts
export interface AiGatewayPublicApi {
  generate(req: AiRequest, opts?: { signal?: AbortSignal }): Promise<AiResult>;
  generateStream(req: AiRequest): AiStream;
  transcribe(req: TranscribeRequest, opts?: { signal?: AbortSignal }): Promise<AiResult>;
  /** Cho màn hình/email khách hàng – CHỈ phần trăm (FR-034). */
  getUsage(): Promise<AiUsage>;
  /** Việc hệ thống (không thuộc tài khoản) – chỉ gọi được khi ngữ cảnh KHÔNG có accountId (FR-038). */
  readonly system: {
    generate(req: AiRequest & { task: 'trend_summary'; industryId: string }): Promise<AiResult>;
  };
}
export class AiError extends Error { readonly code: 'AI_BUDGET_EXHAUSTED' | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_INVALID_REQUEST' | 'AI_SYSTEM_BUDGET_EXHAUSTED'; readonly messageVi: string; readonly retryable: boolean }
export const AI_TASKS: readonly AiTask[];
```

Thao tác nội bộ cho hỗ trợ/quản trị (có số tiền) **không** nằm trong `AiGatewayPublicApi`: `AI_GATEWAY_SUPPORT`
(`getBudgetDetail(accountId)` qua `supportViewAccount`, ghi nhật ký kiểm toán) – chỉ dùng từ controller nội bộ của
chính module. **Tính năng này chỉ khai báo kiểu**; cài đặt kèm nhật ký kiểm toán là WBS 4.7.

## 2. Trình tự bắt buộc của mỗi lời gọi (FR-031)

```
validate(req) ─► pickTier(task, budgetSnapshot) ─► estimate(tier) ─► reserve(est)
     │                                                         └─ không đủ → AI_BUDGET_EXHAUSTED (không gọi NCC)
     ▼
call primary ──ok──► [một giao dịch: settle(actual) + cờ 80/100 + ledger + emit ai_usage_80/100] ─► result
                          └─ giao dịch lỗi → thử settle lại 1 lần → vẫn lỗi: ai.settle_failed, giữ chỗ chờ releaseStale
     └─lỗi/timeout─► release ─► reserve lại ─► call fallback ──ok──► settle…
                                                     └─lỗi─► release ─► AI_PROVIDER_UNAVAILABLE
huỷ (signal/cancel) ─► settle(phần đã sinh) — không có đầu ra ─► release
```

- **Ngay trước mỗi lần gọi** nhà cung cấp (chính và dự phòng): `markCalling(reservationId)` – `held → calling`, đặt
  `called_at` (cập nhật có điều kiện). Giữ chỗ treo > 15 phút: `held` → trả lại; `calling` → quyết toán theo ước tính, sổ
  `anomaly = 'unsettled'`, cảnh báo `ai.unsettled_reservation` (research R8). Nhà cung cấp báo lỗi/hết thời gian → `release`
  (kể cả từ `calling`).

- `pickTier` dùng `used + reserved` đọc trong cùng thao tác giữ chỗ (bản CSDL: `RETURNING`); lời gọi đẩy qua
  ngưỡng mềm vẫn dùng `default` (chấp nhận vượt tối đa 1 lời gọi).
- Kẹp trần khi quyết toán: `used = min(used + actual, cap)`; ledger ghi `actual` thật, `anomaly`,
  `overCapMicroUsd`; nhật ký cảnh báo `ai.cost_anomaly`.
- Lỗi `AI_BUDGET_EXHAUSTED` trong việc nền → bộ xử lý trả `noRetry('AI_BUDGET_EXHAUSTED')` (003).
- Nhật ký `ai_gateway.<op>`: `trace_id`, `account_id` | `scope=system`, `task`, `model_tier`, token, `outcome`,
  `duration_ms`. **Không** lời nhắc, văn bản kết quả, số tiền (số tiền chỉ ở ledger).
- Thời gian chờ nhà cung cấp mặc định: 40 s (một lần), chữ đầu tiên 5 s (trả dần) – cấu hình.

## 3. Giao diện nội bộ

```ts
interface AiProviderAdapter {            // internal/providers/
  readonly provider: string;
  countInputTokens(model: string, prompt: OrderedPrompt): Promise<number>;
  complete(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): Promise<ProviderResult>;
  stream(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): ProviderStream;
  transcribe(model: string, audioUrl: string, signal: AbortSignal): Promise<ProviderResult>;
}
interface BudgetStore {                  // internal/budget/  (tài khoản: tenantTx; hệ thống: systemTx)
  reserve(key: BudgetKey, est: number, meta: ReserveMeta): Promise<{ ok: true; reservationId: string; snapshot: BudgetSnapshot } | { ok: false; snapshot: BudgetSnapshot }>;
  /** Một giao dịch: trừ giữ chỗ, cộng chi phí (kẹp trần), bật cờ 80/100 có điều kiện, ghi sổ, held→settled, rồi
   *  onCrossed(tx, crossed) nếu có mốc mới. onCrossed ném → hủy cả giao dịch (nguyên tắc IV).
   *  Chế độ memory: tx = memoryTx() (contracts/notifications.md mục 6). */
  settle(reservationId: string, actual: number, ledger: LedgerDraft,
    hooks?: { onCrossed?: (tx: Db, crossed: (80 | 100)[]) => Promise<void> }): Promise<{ crossed: (80 | 100)[] }>;
  markCalling(reservationId: string): Promise<void>;      // held → calling, đặt called_at; ngay trước khi gọi NCC
  release(reservationId: string): Promise<void>;          // từ 'held' hoặc 'calling'; gọi lại = không làm gì
  usage(key: BudgetKey): Promise<BudgetSnapshot>;
  /** held quá hạn → released; calling quá hạn → settled theo ước tính (kẹp trần) + sổ anomaly='unsettled'. */
  releaseStale(olderThanMs: number,
    hooks?: { onCrossed?: (tx: Db, crossed: (80 | 100)[]) => Promise<void> }): Promise<{ released: number; settledAtEstimate: number }>;
}
interface PriceSource { load(): Promise<PriceEntry[]> }   // tiêm vào: giả = JSON; thật (WBS 3.1) = bảng model_prices
interface PriceBook { priceFor(tier: ModelTier, at: Date): PriceEntry }   // đọc từ PriceSource, đổi giá không phát hành
```

## 4. Bản giả lập

- `FakeAiProvider` (×2: `primary`, `fallback`): văn bản tất định `"[fake:{task}] " + sha256(prompt).slice(0,8)` lặp
  tới số token đầu ra cấu hình; trả dần theo đoạn 8 token; kịch bản: `{ latencyMs, firstTokenMs, fail: 'error' |
  'timeout', outputTokens, actualCostMultiplier }`.
- `MemoryBudgetStore` / `SandboxBudgetStore` (bảng `ai_fake_*`), `SystemBudgetStore` tương ứng.
- Bảng giá giả (JSON trong cấu hình bản giả lập): `default` 3/15, `cheap` 0,25/1,25, `cheap_vision` 0,25/1,25 USD
  mỗi triệu token (lưu micro-USD); `stt` 6 000 micro-USD/phút.
- API lập trình: `fakeAi.setBudget({ used, reserved, cap?, cycleStart? })`, `fakeAi.script(steps)`,
  `fakeAi.ledger()`, `fakeAi.reservations()`, `fakeAi.reset()`.

## 5. Bộ kiểm thử hợp đồng (`test/contracts/ai/`)

`describeAiGatewayContract(makeGateway, harness)` – chạy với `memory` (`pnpm test`) và `sandbox` (`pnpm test:db`):

1. Trình tự US3-AS1 (ledger đủ trường, `used/reserved` đúng sau quyết toán).
2. Chặn trước khi gọi khi `used + reserved + est > cap`; nhà cung cấp không nhận lời gọi nào.
3. **Đồng thời**: 100 vòng × 25 lời gọi `Promise.all` sát trần (ước tính ngẫu nhiên có hạt giống) → sau mỗi vòng
   `used + reserved ≤ cap` ở mọi thời điểm quan sát (bộ quan sát đọc sau mỗi thao tác) và `reserved = 0` khi xong (SC-003).
4. Ngưỡng mềm: `< 2 000 000` → `default`; `≥` → `cheap`; nhãn/xu hướng luôn `cheap*`.
5. Dự phòng đúng 1 lần; cả hai lỗi → `AI_PROVIDER_UNAVAILABLE`, `reserved = 0`.
6. Trả dần bị hủy giữa chừng → quyết toán phần đã sinh, phần còn lại trả.
7. STT: ước tính theo `min(duration, 300 s)`.
8. `getUsage()` – quét đệ quy kết quả: không khóa nào chứa `usd|micro|cost|amount|price`, không số nguyên ≥ 1 000
   ngoài `percent`… (SC-004); `percent = floor((used+reserved)/cap×100)`.
9. Kẹp trần + `anomaly` khi `actual > est`; bất biến giữ nguyên.
10. Giữ chỗ treo > 15 phút: `held` (chưa gọi) → `releaseStale` trả lại; `calling` (nhà cung cấp đã trả lời nhưng không
    quyết toán – mô phỏng tiến trình chết) → `used` tăng đúng ước tính (kẹp trần), sổ có dòng `anomaly = 'unsettled'`, nhật
    ký `ai.unsettled_reservation`; chạy `releaseStale` lần hai không đổi gì.
11. `system.generate` trong ngữ cảnh tài khoản → ném; trong ngữ cảnh hệ thống không chạm ngân sách tài khoản,
    không đổi `getUsage()` của khách; hết trần tuần → `AI_SYSTEM_BUDGET_EXHAUSTED` + nhật ký cảnh báo.
12. Vượt 80% rồi 100% → mỗi mốc phát đúng 1 sự kiện thông báo trong chu kỳ; chu kỳ mới phát lại được.
13. (chỉ `sandbox`) `onCrossed`/`emit` ném lỗi → giao dịch quyết toán hủy: 0 cờ bật, 0 dòng sổ, 0 sự kiện, giữ chỗ vẫn
    `held`; `settle` lại thành công → đúng 1 sự kiện.
14. (chỉ `sandbox`) `reserve` p95 ≤ 50 ms qua 200 lần trên CSDL cục bộ (hiến pháp III).
