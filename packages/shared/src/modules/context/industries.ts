// Danh mục ngành kinh doanh (006 research R5): hằng số dùng chung web ↔ API, KHÔNG phải bảng CSDL.
// Thêm ngành = thêm một dòng ở đây (phát hành mới), không đổi cấu trúc CSDL.
// Mã đã dùng KHÔNG được xóa hay đổi nghĩa: hồ sơ cũ vẫn lưu mã đó và phải hiển thị được.

export const INDUSTRIES = [
  { code: 'fashion', label: 'Thời trang' },
  { code: 'food_beverage', label: 'Ăn uống' },
  { code: 'cosmetics', label: 'Mỹ phẩm' },
  { code: 'education', label: 'Giáo dục' },
  { code: 'beauty_services', label: 'Dịch vụ làm đẹp' },
  { code: 'other', label: 'Khác' },
] as const;

export type IndustryCode = (typeof INDUSTRIES)[number]['code'];

/** Bộ mã dạng tuple cho `z.enum`. */
export const INDUSTRY_CODES = INDUSTRIES.map((i) => i.code) as unknown as readonly [
  IndustryCode,
  ...IndustryCode[],
];

/** Nhãn tiếng Việt của một mã ngành (mã lạ → chính mã đó). */
export function industryLabel(code: string): string {
  return INDUSTRIES.find((i) => i.code === code)?.label ?? code;
}
