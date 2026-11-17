// Vị trí tệp của media (014 data-model.md mục 4, R8) – dựng CHỈ từ ngữ cảnh tài khoản + mã media (UUID), qua các hàm
// dựng vị trí HỢP KIỂU của kho tệp (`loc.*`: khóa là `tenants/{acc}/media/{mediaId}/…`). TÊN TỆP của người dùng KHÔNG
// BAO GIỜ vào khóa (chống `../`, tên dài, ký tự lạ) – tên chỉ nằm ở cột `display_name` sau khi chuẩn hóa.
import { loc, type StorageLocation } from '../../../core/storage';

/** Tệp gốc người dùng tải lên – không ghi đè sau khi đã xác nhận. */
export const originalLoc = (mediaId: string): StorageLocation => loc.mediaOriginal(mediaId);
/** JPEG chuẩn hóa (chỉ ảnh), cạnh dài ≤ 2048 px. */
export const normalizedLoc = (mediaId: string): StorageLocation =>
  loc.mediaNormalized(mediaId, 'jpeg');
/** Ảnh thu nhỏ JPEG ≤ 480 px (ảnh và video). */
export const thumbLoc = (mediaId: string): StorageLocation => loc.mediaThumb(mediaId);

/** Mọi tệp của một media (xóa nền, đối soát). */
export const allLocs = (mediaId: string): StorageLocation[] => [
  originalLoc(mediaId),
  normalizedLoc(mediaId),
  thumbLoc(mediaId),
];

/** Tên hiển thị rỗng sau chuẩn hóa. */
export class InvalidDisplayNameError extends Error {
  constructor() {
    super('Tên tệp rỗng sau khi chuẩn hóa');
    this.name = 'InvalidDisplayNameError';
  }
}

const MAX_DISPLAY_NAME = 255;

/**
 * Chuẩn hóa tên hiển thị: NFC, bỏ ký tự điều khiển/định dạng, bỏ `/` và `\`, gộp khoảng trắng, cắt còn 1–255 ký tự
 * (theo điểm mã, khớp `char_length` của PostgreSQL). Giữ tiếng Việt có dấu. Rỗng ⇒ `InvalidDisplayNameError`.
 */
export function normalizeDisplayName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    // Tab/xuống dòng thành dấu cách TRƯỚC khi bỏ ký tự điều khiển để không dính chữ.
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- cố ý loại ký tự điều khiển (C0/C1) và ký tự định dạng vô hình
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- đếm theo điểm mã, không theo đơn vị UTF-16
  const chars = [...cleaned];
  const cut = chars.slice(0, MAX_DISPLAY_NAME).join('').trim();
  if (cut === '') throw new InvalidDisplayNameError();
  return cut;
}
