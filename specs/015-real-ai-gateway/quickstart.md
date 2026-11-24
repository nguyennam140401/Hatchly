# Quickstart kiểm chứng — Cổng AI thật

Mục tiêu: chứng minh tính năng chạy đầu-cuối. Chi tiết bảng/hợp đồng xem [`data-model.md`](./data-model.md) và [`contracts/`](./contracts/). Không chứa mã cài đặt.

## 0. Điều kiện

- Chạy trong worktree `impl/015-real-ai-gateway` (`.claude/worktrees/015-real-ai-gateway`); `pnpm install` đã xong.
- PostgreSQL cục bộ: `pnpm db:up` rồi `pnpm db:bootstrap` và `pnpm db:setup` (đã có `ai_gateway` sau migration `0029`–`0031`).
- Không chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080).
- Mục 1–5 **không cần khóa nhà cung cấp** (dùng nhà cung cấp giả hoặc máy chủ HTTP giả cục bộ). Chỉ mục 6 cần khóa thật.

## 1. Cổng kiểm tra tĩnh

```bash
pnpm typecheck && pnpm lint
pnpm check:boundaries          # ai_gateway không import module khác ngoài account/notifications/queue; SDK chỉ ở internal/providers
pnpm db:lint-migrations        # 0029/0030/0031 chỉ thêm, tương thích ngược
pnpm db:check                  # mọi bảng tenant mới có RLS, account_id đầu chỉ mục; bảng shared có reason
pnpm check:secrets
```
Kỳ vọng: tất cả đạt. (Hai lỗi `pnpm verify` có sẵn ở `dev` — `check-wiki.spec.ts`, `tooling/infra` — không thuộc 015, xem `open-questions`.)

## 2. Hợp đồng + đồng thời trên CSDL thật (US1, US2, US3; SC-001/002/003/005/006/007)

```bash
pnpm test:db -- test/contracts/ai        # 14 mục của 005 + mục 15–20 (delta)
```
Kỳ vọng:
- 100 vòng × 25 lời gọi song song sát trần: `used + reserved ≤ cap` ở mọi lần quan sát, `reserved = 0` khi xong; 0 lời gọi nhà cung cấp cho lời gọi bị từ chối.
- `reserve` p95 ≤ 50 ms (200 lần).
- Ngưỡng 1,99 / 2,00 / 2,01 USD chọn đúng bậc; gán nhãn/xu hướng luôn bậc rẻ.
- Tổng sổ của một `(tài khoản, chu kỳ)` khớp `used` (sai lệch 0, trừ phần kẹp trần có cờ).
- Đổi giá hiệu lực từ T: trước T giá cũ, sau T giá mới, quá khứ không đổi.

## 3. Idempotency và chu kỳ (US1/FR-014, FR-037a; SC-010, SC-011)

```bash
pnpm test:db -- test/ai_gateway/request-id test/ai_gateway/cycle
pnpm test:queue -- test/queue/ai_gateway-release-stale
```
Kỳ vọng: cùng `requestId` → lần hai `AI_DUPLICATE_REQUEST` (`settled` hoặc `in_progress`), đúng một dòng sổ, một lần gọi nhà cung cấp; lỗi nhà cung cấp rồi thử lại cùng mã chạy được;
ngày kích hoạt 29/30/31 và tháng 2 ra đúng `cycle_start`; hai yêu cầu đầu chu kỳ đồng thời tạo một dòng; giữ chỗ treo (giả lập tuổi 16 phút) được trả/quyết toán, chạy dọn hai lần như một lần;
mốc 80% và 100% phát đúng một thông báo mỗi chu kỳ kể cả khi quyết toán bị thử lại.

## 4. Dự phòng, STT, hệ thống (US4, US5, US7)

```bash
pnpm test:db -- test/ai_gateway/fallback test/ai_gateway/stt test/ai_gateway/system-budget
```
Kỳ vọng: nhà cung cấp chính lỗi → trả giữ chỗ, giữ chỗ lại theo giá dự phòng, gọi dự phòng **đúng một lần**, sổ ghi nhà cung cấp dự phòng; cả hai lỗi → ngân sách không bị trừ;
`transcription` chưa bật dự phòng + lỗi → `AI_PROVIDER_UNAVAILABLE` ngay, không lời gọi thứ hai; STT 90 s / 300 s / 720 s → ước tính theo `min(thời lượng, 300 s)`, chi phí thực ≤ ước tính;
trần hệ thống = số ngành × mức/ngành; hết trần → `AI_SYSTEM_BUDGET_EXHAUSTED` không ảnh hưởng tài khoản; phân bổ chia đều và tổng đúng chi phí.

## 5. Quyền, kiểm toán, không lộ tiền, cô lập (US3-AS2, US6, US8; SC-004)

```bash
pnpm test:db -- test/ai_gateway/admin test/ai_gateway/rls-cross-account test/ai_gateway/no-money
```
Kỳ vọng:
- `POST /admin/ai/prices` bởi `admin` thành công và có dòng kiểm toán (người đổi, cũ/mới, hiệu lực); giá ≤ 0 hoặc lệch > 10× → bị từ chối; `support`/khách → 403; `soft ≥ cap` bị từ chối.
- Tài khoản A đọc/sửa/xóa `ai_budgets`, `ai_reservations`, `ai_cost_ledger`, `ai_trend_allocations` của B → thất bại.
- Quét đệ quy `getUsage()`, thông báo `ai_usage_80/100` và email mẫu: không khóa/chuỗi nào chứa số tiền, đơn giá hay chi phí; chỉ có phần trăm làm tròn xuống.
- Xem chi phí một tài khoản qua `support` ghi `support.view_account` kèm lý do.

## 6. Nhà cung cấp thật (thủ công, sau POC — không chạy ở CI) (FR-025–027; SC-008, SC-009, SC-012)

1. Đặt `AI_GATEWAY_DRIVER=real`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`.env` cục bộ hoặc `Secret` staging; **không commit**).
2. Nạp giá thật bằng `POST /admin/ai/prices` (hiệu lực ≥ TTL đệm sau thời điểm gọi).
3. Tạo 1 bài (`post_generation`), kiểm: chữ đầu ≤ 5 s, p95 tạo bài ≤ 45 s; một dòng sổ với token thực; `used` tăng đúng chi phí; không có lời nhắc/kết quả trong nhật ký.
4. Làm lỗi nhà cung cấp chính (khóa sai) → dự phòng được gọi đúng một lần.
5. Gán nhãn một video có giọng nói: STT chỉ 5 phút đầu, tính theo phút; tệp trùng dấu tệp không phát sinh lời gọi mới.
6. Ghi kết quả vào `research.md` mục "Kết quả đo" (POC-1/POC-4): chi phí trung bình/bài, hệ số `ai_gateway_estimate_ratio`, tỷ lệ lỗi nhà cung cấp. Chốt hệ số an toàn ước tính và giá thật.

## 7. Dọn dẹp / hồi quy bản giả lập

- `AI_GATEWAY_DRIVER=fake` (mặc định dev/test) vẫn chạy: `pnpm test` (chế độ bộ nhớ) và `pnpm test:db` (chế độ `sandbox`) đạt như trước.
- Production với `AI_GATEWAY_DRIVER=fake` vẫn bị từ chối khi khởi động (`assert-no-fakes`).
