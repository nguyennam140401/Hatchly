import { createSingleTransport, type SingleTransportOptions } from './single';
import type { UploadTransport } from './types';

/**
 * Tải nhiều phần (tiếp tục từ phần đang dở khi mạng chập chờn) – KHUNG, bật khi kho tệp hỗ trợ multipart
 * (quyết định ở tính năng Thư viện media, xem plan.md "Rủi ro"). Bản đầu thử lại CẢ TỆP bằng vận chuyển một lần.
 */
export const MULTIPART_SUPPORTED = false;

export function createMultipartTransport(options: SingleTransportOptions): UploadTransport {
  // Khi kho hỗ trợ: tách tệp thành các phần, `putPart` từng phần có thử lại riêng, `complete` ghép phần.
  return createSingleTransport(options);
}
