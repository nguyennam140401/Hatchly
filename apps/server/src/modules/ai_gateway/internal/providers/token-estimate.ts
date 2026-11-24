// Bộ ước tính token đầu vào CỤC BỘ (015, R-09, FR-003, FR-009): không gọi mạng, thuần hàm, chặn trên.
// `ceil(bytes UTF-8 / 3)` × (1 + safetyPercent / 100), làm tròn LÊN – ước tính là chi phí tối đa nên tính dư,
// không bao giờ thiếu. Tính hoàn toàn bằng số nguyên (tiếng Việt có dấu tốn nhiều byte hơn → ước tính cao hơn).

/** Số token đầu vào ước tính của một văn bản; `safetyPercent` là số nguyên ≥ 0 (`AI_TOKEN_ESTIMATE_SAFETY_PERCENT`). */
export function estimateInputTokens(text: string, safetyPercent: number): number {
  if (text.length === 0) return 0;
  const bytes = Buffer.byteLength(text, 'utf8');
  const base = BigInt(Math.ceil(bytes / 3));
  const factor = BigInt(100 + Math.max(0, Math.ceil(safetyPercent)));
  // ceil(base × factor / 100) bằng số nguyên lớn: không tràn, không sai số thực.
  return Number((base * factor + 99n) / 100n);
}
