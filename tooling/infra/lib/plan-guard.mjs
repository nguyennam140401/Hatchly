// Ba lớp chặn lên phát hành (T092, contracts/infra-cli.md mục 4). Hàm THUẦN: nhận dữ liệu đã nạp, không gọi mạng.
// Thông điệp giữ NGUYÊN VĂN theo hợp đồng.
import { EXIT } from './exit-codes.mjs';
import { shortHash } from './definition-hash.mjs';

/** @typedef {{ ok: boolean, code: number, message: string, details: string[], warn?: boolean, skipped?: boolean, dataLossConfirmed?: boolean }} Verdict */

/** @returns {Verdict} */
const pass = (extra = {}) => ({ ok: true, code: EXIT.OK, message: '', details: [], ...extra });
/** @returns {Verdict} */
const block = (message, details = []) => ({ ok: false, code: EXIT.BLOCKED, message, details });

/**
 * (a) Đã chạy ở thử nghiệm: production cần bản ghi áp dụng của CẢ HAI stack ở thử nghiệm với đúng `definitionHash`.
 * @param {{ env: string, definitionHash: string, stagingRecords: { stack: string }[] }} input
 */
export function guardStagingFirst({ env, definitionHash, stagingRecords }) {
  if (env !== 'production') return pass({ skipped: true });
  const stacks = new Set(stagingRecords.map((r) => r.stack));
  const missing = ['cloud', 'platform'].filter((s) => !stacks.has(s));
  if (missing.length === 0) return pass();
  return block(
    `Thay đổi này chưa áp dụng thành công ở thử nghiệm (dấu ${shortHash(definitionHash)}). Chạy \`pnpm infra apply staging\` trước.`,
    missing.map((s) => `thiếu bản ghi stack ${s} ở thử nghiệm`),
  );
}

/**
 * (b) Đúng bản đã lưu: có tệp, dấu khớp, chưa quá hạn.
 * @param {{ env: string, planExists: boolean, meta?: { definitionHash: string, paramsHash: string, expiresAt: string } | undefined, currentDefinitionHash: string, currentParamsHash: string, now?: Date }} input
 */
export function guardSavedPlan({
  env,
  planExists,
  meta,
  currentDefinitionHash,
  currentParamsHash,
  now = new Date(),
}) {
  if (!planExists || meta === undefined)
    return block(`Chưa có bản xem trước. Chạy \`pnpm infra plan ${env}\` trước.`);
  if (new Date(meta.expiresAt).getTime() < now.getTime()) {
    return block(`Bản xem trước đã quá 24 giờ. Chạy lại \`pnpm infra plan ${env}\`.`);
  }
  if (meta.definitionHash !== currentDefinitionHash || meta.paramsHash !== currentParamsHash) {
    return block(`Mã hoặc tham số đã đổi sau khi xem trước. Chạy lại \`pnpm infra plan ${env}\`.`);
  }
  return pass();
}

/**
 * (c) Tài nguyên chứa dữ liệu: production chặn xóa/thay thế trừ khi (đã gỡ bảo vệ ở lần áp dụng TRƯỚC) +
 * `--confirm-data-loss` + gõ lại `production`. Staging chỉ cảnh báo (hỏi y/N ở nơi gọi).
 * @param {{ env: string, protectedChanges: { address: string, action: string }[], confirmDataLoss: boolean, typedConfirmation: boolean, protectionRemoved: Set<string> }} input
 */
export function guardDataLoss({
  env,
  protectedChanges,
  confirmDataLoss,
  typedConfirmation,
  protectionRemoved,
}) {
  if (protectedChanges.length === 0) return pass({ dataLossConfirmed: false });
  const list = protectedChanges.map(
    (c) => `${c.action === 'delete' ? 'XÓA' : 'THAY THẾ'} ${c.address}`,
  );
  if (env !== 'production') return pass({ warn: true, details: list, dataLossConfirmed: false });

  const unprotected = protectedChanges.every((c) => protectionRemoved.has(c.address));
  if (unprotected && confirmDataLoss && typedConfirmation) {
    return pass({ dataLossConfirmed: true, details: list });
  }

  const why = [];
  if (!unprotected) why.push('bảo vệ xóa của tài nguyên chưa được gỡ ở một lần áp dụng trước');
  if (!confirmDataLoss) why.push('thiếu --confirm-data-loss');
  if (unprotected && confirmDataLoss && !typedConfirmation) why.push('chưa gõ lại "production"');
  return block(
    `Bản xem trước sẽ XÓA/THAY THẾ: ${protectedChanges.map((c) => c.address).join(', ')}. ` +
      'Quy trình gỡ bảo vệ: (1) áp dụng riêng một thay đổi tắt bảo vệ xóa (deletion_protection = false); ' +
      '(2) chạy lại với --confirm-data-loss và gõ lại "production".',
    [...list, ...why],
  );
}
