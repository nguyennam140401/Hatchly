import type {
  ChannelType,
  ClassifiedError,
  ErrorCategory,
  ErrorMappingRow,
} from '../../public-api';

// Phân loại lỗi nền tảng (005, FR-015, research R5): mỗi bộ chuyển đổi có bảng mặc định; mã ngoài bảng →
// `unknown` (không bao giờ đoán là "chắc chắn chưa nhận"). Mã gốc được lọc trước khi ra khỏi cổng.

export interface ErrorTableEntry {
  category: ErrorCategory;
  messageVi: string;
  remedies: ClassifiedError['remedies'];
  retryAfterSec?: number;
}

export type ErrorTable = Readonly<Record<string, ErrorTableEntry>>;

export const UNKNOWN_MESSAGE_VI =
  'Chưa rõ bài đã lên hay chưa. Vui lòng kiểm tra trên trang trước khi đăng lại để tránh đăng trùng.';

const UNKNOWN_REMEDIES: ClassifiedError['remedies'] = [
  { action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' },
];

/** Giữ `[A-Za-z0-9_.:-]`, cắt ≤ 64 ký tự; rỗng → `UNKNOWN`. */
export function sanitizeRawCode(raw: string): string {
  const cleaned = String(raw)
    .replace(/[^A-Za-z0-9_.:-]/g, '')
    .slice(0, 64);
  return cleaned === '' ? 'UNKNOWN' : cleaned;
}

export function makeClassifier(
  channelType: ChannelType,
  table: ErrorTable,
): (rawCode: string) => ClassifiedError {
  return (rawCode) => {
    const code = sanitizeRawCode(rawCode);
    const entry = Object.hasOwn(table, code) ? table[code] : undefined;
    if (entry === undefined) {
      return {
        category: 'unknown',
        rawCode: code,
        channelType,
        messageVi: UNKNOWN_MESSAGE_VI,
        remedies: [...UNKNOWN_REMEDIES] as ClassifiedError['remedies'],
      };
    }
    return {
      category: entry.category,
      rawCode: code,
      channelType,
      messageVi: entry.messageVi,
      remedies: [...entry.remedies] as ClassifiedError['remedies'],
      ...(entry.category === 'transient' && entry.retryAfterSec !== undefined
        ? { retryAfterSec: entry.retryAfterSec }
        : {}),
    };
  };
}

/**
 * Áp dòng ánh xạ của Đăng bài lên kết quả phân loại mặc định (hàm thuần, công khai). Khớp
 * `channelType` + `rawCode` → thay `category/messageVi/remedies`, giữ `rawCode`, `channelType`.
 */
export function applyErrorMapping(err: ClassifiedError, row?: ErrorMappingRow): ClassifiedError {
  if (row === undefined) return err;
  if (row.channelType !== err.channelType || row.rawCode !== err.rawCode) return err;
  const { retryAfterSec, ...rest } = err;
  return {
    ...rest,
    category: row.category,
    messageVi: row.messageVi,
    remedies: [...row.remedies] as ClassifiedError['remedies'],
    ...(row.category === 'transient' && retryAfterSec !== undefined ? { retryAfterSec } : {}),
  };
}
