import type { PriceEntry } from './prices/price-book';

// Ước tính / tính chi phí (005, R7). Tiền là SỐ NGUYÊN micro-USD; nhân/chia bằng bigint, làm tròn LÊN
// (ước tính là chi phí tối đa – tính dư, không bao giờ thiếu). Không số thực ở bất kỳ bước nào.

const MILLION = 1_000_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a + b - 1n) / b;
}

/** `ceil(inTok × inPrice + maxOutTok × outPrice)` (giá theo 1 triệu token). */
export function estimateTokens(
  price: PriceEntry,
  inputTokens: number,
  maxOutputTokens: number,
): number {
  const total =
    BigInt(inputTokens) * BigInt(price.inputPerMTokMicroUsd) +
    BigInt(maxOutputTokens) * BigInt(price.outputPerMTokMicroUsd);
  return Number(ceilDiv(total, MILLION));
}

/**
 * Hệ số giá GHI bộ đệm so với giá nhập thường (%): Anthropic tính ghi bộ đệm ≈ 1,25× giá nhập (TTL 5 phút). Hằng số cố
 * định vì bảng `model_prices` chưa có cột giá-ghi-đệm; nếu nhà cung cấp đổi hệ số → sửa ở đây (hoặc thêm cột, cần data-dev).
 * Chỉ dùng khi QUYẾT TOÁN; ước tính trước giữ chỗ không tính bộ đệm (coi mọi token nhập là giá thường – chặn trên đã có
 * biên an toàn token; phần vượt, nếu có, bị kẹp bởi trần và ghi `over_estimate`).
 */
export const CACHE_WRITE_MULTIPLIER_PERCENT = 125n;

/**
 * Chi phí thực theo token đã dùng. `inputTokens` là TỔNG gồm cả phần đọc bộ đệm (`cachedInputTokens`, giá đọc-bộ-đệm
 * `cachedInputPerMTok`) và phần ghi bộ đệm (`cacheWriteInputTokens`, giá nhập × 1,25); phần còn lại tính giá nhập thường.
 */
export function actualTokensCost(
  price: PriceEntry,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens?: number | undefined;
  },
): number {
  const write = Math.min(
    Math.max(0, usage.cacheWriteInputTokens ?? 0),
    Math.max(0, usage.inputTokens - usage.cachedInputTokens),
  );
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens - write);
  // Nhân 100 để áp hệ số % bằng số nguyên: tổng×100 rồi chia (MILLION×100), làm tròn lên.
  const total =
    BigInt(fresh) * BigInt(price.inputPerMTokMicroUsd) * 100n +
    BigInt(write) * BigInt(price.inputPerMTokMicroUsd) * CACHE_WRITE_MULTIPLIER_PERCENT +
    BigInt(usage.cachedInputTokens) * BigInt(price.cachedInputPerMTokMicroUsd) * 100n +
    BigInt(usage.outputTokens) * BigInt(price.outputPerMTokMicroUsd) * 100n;
  return Number(ceilDiv(total, MILLION * 100n));
}

/** Giới hạn độ dài âm thanh tính tiền/ước tính: 5 phút đầu (spec – video). */
export const STT_MAX_SECONDS = 300;

/**
 * Số giây TÍNH TIỀN của ƯỚC TÍNH GIỮ CHỖ: kẹp [0, 300] rồi làm tròn LÊN theo `billing_granularity_sec` (1 hoặc 60;
 * thiếu = 1), kẹp lại ≤ 300. Quyết toán dùng thời lượng THỰC nhà cung cấp báo (`billedSttSecondsActual`, không kẹp 300;
 * > 300 s ghi `over_estimate`). SC-009 (chi phí thực ≤ ước tính) chỉ đúng khi bên gọi cắt 5 phút đầu của âm thanh
 * trước khi gửi (FR-021 phía bên gọi); Cổng AI không tự cắt.
 */
export function billedSttSeconds(price: PriceEntry, seconds: number): number {
  const gran = Math.max(1, Math.floor(price.billingGranularitySec ?? 1));
  const clamped = Math.ceil(Math.min(Math.max(seconds, 0), STT_MAX_SECONDS));
  return Math.min(STT_MAX_SECONDS, Math.ceil(clamped / gran) * gran);
}

function sttCost(price: PriceEntry, billedSeconds: number): number {
  return Number(ceilDiv(BigInt(billedSeconds) * BigInt(price.perAudioMinuteMicroUsd ?? 0), 60n));
}

/**
 * STT: `ceil(làm tròn lên theo độ chi tiết(min(durationSec, 300)) / 60 × đơn giá/phút)`.
 * HỢP ĐỒNG: `durationSec` do bên gọi (module media) báo và chịu trách nhiệm là thời lượng THẬT (vd đo bằng ffprobe);
 * Cổng AI chỉ kiểm hữu hạn và > 0 (gateway.service.ts), không tự đo được.
 */
export function estimateStt(price: PriceEntry, durationSec: number): number {
  return sttCost(price, billedSttSeconds(price, durationSec));
}

/**
 * Số giây TÍNH TIỀN THỰC: làm tròn LÊN theo độ chi tiết, KHÔNG kẹp 300 (nhà cung cấp tính đủ thời lượng tệp đã gửi).
 * Phần vượt ước tính được kho quyết toán kẹp theo trần ngân sách và ghi `over_cap` (nguyên tắc III).
 */
export function billedSttSecondsActual(price: PriceEntry, seconds: number): number {
  const gran = Math.max(1, Math.floor(price.billingGranularitySec ?? 1));
  const whole = Math.ceil(Math.max(seconds, 0));
  return Math.ceil(whole / gran) * gran;
}

/** STT quyết toán theo số giây nhà cung cấp báo (thời lượng thực, làm tròn lên theo độ chi tiết, không kẹp 300). 0 giây → 0. */
export function actualSttCost(price: PriceEntry, audioSeconds: number): number {
  return sttCost(price, billedSttSecondsActual(price, audioSeconds));
}

/**
 * Lời gọi nhỏ nhất THỰC TẾ (1000 token vào + 500 token ra). Lý do: ước tính của một lời gọi thật (gán nhãn, soạn bài)
 * luôn từ hàng trăm micro-USD trở lên; nếu lấy 0 vào + 1 ra (~5 micro-USD) thì khoảng trống còn lại gần như không bao
 * giờ rơi vào ngưỡng đó → cờ 100% và trạng thái `blocked` không bật dù mọi lời gọi đã bị từ chối (FR-030).
 */
export const MIN_CALL_INPUT_TOKENS = 1000;
export const MIN_CALL_OUTPUT_TOKENS = 500;

/**
 * Chi phí nhỏ nhất của một lời gọi (để biết "đã chặn hẳn") theo giá `cheap_vision` hiện hành – MỘT hàm duy nhất cho
 * `getUsage`, cờ 100% và nơi chặn. Bigint, làm tròn lên (qua `estimateTokens`).
 */
export function minCallEstimate(cheapVision: PriceEntry): number {
  return estimateTokens(cheapVision, MIN_CALL_INPUT_TOKENS, MIN_CALL_OUTPUT_TOKENS);
}

/** Token ước tính cho mỗi khung hình đầu vào (khung thu nhỏ). */
export const IMAGE_INPUT_TOKENS = 800;
