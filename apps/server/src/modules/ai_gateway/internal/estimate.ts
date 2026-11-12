import type { PriceEntry } from './prices/price-book';

// Ước tính / tính chi phí (005, R7). Tiền là SỐ NGUYÊN micro-USD; nhân/chia bằng bigint, làm tròn LÊN
// (ước tính là chi phí tối đa – tính dư, không bao giờ thiếu). Không số thực ở bất kỳ bước nào.

const MILLION = 1_000_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a + b - 1n) / b;
}

/** `ceil(inTok × inPrice + maxOutTok × outPrice)` (giá theo 1 triệu token). */
export function estimateTokens(price: PriceEntry, inputTokens: number, maxOutputTokens: number): number {
  const total =
    BigInt(inputTokens) * BigInt(price.inputPerMTokMicroUsd) +
    BigInt(maxOutputTokens) * BigInt(price.outputPerMTokMicroUsd);
  return Number(ceilDiv(total, MILLION));
}

/** Chi phí thực theo token đã dùng (token đầu vào đã đệm tính giá riêng). */
export function actualTokensCost(
  price: PriceEntry,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): number {
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const total =
    BigInt(fresh) * BigInt(price.inputPerMTokMicroUsd) +
    BigInt(usage.cachedInputTokens) * BigInt(price.cachedInputPerMTokMicroUsd) +
    BigInt(usage.outputTokens) * BigInt(price.outputPerMTokMicroUsd);
  return Number(ceilDiv(total, MILLION));
}

/** Giới hạn độ dài âm thanh tính tiền/ước tính: 5 phút đầu (spec – video). */
export const STT_MAX_SECONDS = 300;

/** STT: `ceil(min(durationSec, 300) / 60 × pricePerMin)`. */
export function estimateStt(price: PriceEntry, durationSec: number): number {
  const seconds = BigInt(Math.ceil(Math.min(Math.max(durationSec, 0), STT_MAX_SECONDS)));
  return Number(ceilDiv(seconds * BigInt(price.perAudioMinuteMicroUsd ?? 0), 60n));
}

/**
 * Chi phí nhỏ nhất của một lời gọi (để biết "đã chặn hẳn"): `image_labeling` với 0 token đầu vào,
 * `maxOutputTokens = 1`, theo giá `cheap_vision` hiện hành – không hằng số cứng.
 */
export function minCallEstimate(cheapVision: PriceEntry): number {
  return estimateTokens(cheapVision, 0, 1);
}

/** Token ước tính cho mỗi khung hình đầu vào (khung thu nhỏ). */
export const IMAGE_INPUT_TOKENS = 800;
