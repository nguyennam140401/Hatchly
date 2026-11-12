import { createHash } from 'node:crypto';

// Dấu nội dung (005, FR-014a, research R4): "ch1:" + sha256_hex(normalize(text)). Chuẩn hóa chịu được các
// "đổi nhẹ" của nền tảng (rút gọn liên kết, đổi dạng Unicode, khoảng trắng, ký tự vô hình) nhưng KHÔNG
// hạ chữ thường – khác hoa/thường là nội dung khác. Media không vào dấu. Tiền tố phiên bản cho phép đổi
// thuật toán mà không so nhầm dấu cũ.

export const CONTENT_HASH_PREFIX = 'ch1:';

const URL_RE = /https?:\/\/\S+/g;
// ZWSP, ZWNJ, ZWJ, WORD JOINER, BOM.
const INVISIBLE_RE = /[​‌‍⁠﻿]/g;
// NBSP, NNBSP, các dấu cách Unicode khác.
const SPACE_LIKE_RE = /[  -   　]/g;

export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(URL_RE, '<url>')
    .replace(INVISIBLE_RE, '')
    .replace(SPACE_LIKE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `extraNormalize` – bước riêng của một bộ chuyển đổi (vd bỏ hashtag cuối), chạy sau chuẩn hóa chung. */
export function contentHashOf(text: string, extraNormalize?: (normalized: string) => string): string {
  const base = normalizeText(text);
  const normalized = extraNormalize === undefined ? base : extraNormalize(base);
  return CONTENT_HASH_PREFIX + createHash('sha256').update(normalized, 'utf8').digest('hex');
}
