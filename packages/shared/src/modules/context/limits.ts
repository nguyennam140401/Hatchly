// Giới hạn độ dài hồ sơ kinh doanh (006 research R6, data-model mục 3) – MỘT nguồn cho lược đồ Zod
// (web + máy chủ, cùng thông điệp). CSDL có CHECK `char_length` tương ứng (lớp chặn thứ hai):
// đổi giới hạn ở đây PHẢI kèm migration đổi CHECK.

export const PROFILE_LIMITS = {
  industryOther: 100,
  introduction: 2000,
  products: 5000,
  policies: 5000,
  tone: 500,
  keywordsMax: 20,
  keywordLength: 50,
} as const;

/**
 * Số "ký tự" theo điểm mã Unicode – khớp `char_length` của PostgreSQL (emoji 😀 = 1 ký tự, trong khi
 * `'😀'.length === 2`).
 */
export function charCount(s: string): number {
  // Cố ý đếm theo điểm mã (không theo cụm hiển thị) để khớp char_length của PostgreSQL.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return [...s].length;
}

/** Định dạng số kiểu Việt Nam: 2000 → "2.000". */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
