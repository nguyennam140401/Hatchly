import { gatewayEvent } from '../events';
import { invoiceLedgerTotal, invoiceProvidersForDay } from '../db/summary-functions';

// Đối soát sổ chi phí AI với hóa đơn nhà cung cấp (015 US8 T067, FR-034, hiến chương VIII): ngày HÔM QUA theo giờ Việt Nam,
// mỗi nhà cung cấp một kết luận. |Σ sổ − hóa đơn| / hóa đơn > 5% (đúng 5% thì không) → `ai.invoice_mismatch` {provider,
// invoice_date, deviation_pct}. Hóa đơn = 0: sổ > 0 → lệch 100% (cảnh báo), sổ = 0 → không báo. Thiếu hóa đơn → ghi nhận
// mức info `ai.invoice_missing` (KHÔNG báo giả). Chỉ ghi nhật ký, không đổi dữ liệu → chạy lại cho cùng kết quả.

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
export const INVOICE_MISMATCH_PERCENT = 5n;

/** Ngày hôm qua theo giờ Việt Nam (`YYYY-MM-DD`) tại thời điểm `at`. */
export function reconcileDay(at: Date = new Date()): string {
  return new Date(at.getTime() + VN_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}

export interface Deviation {
  mismatch: boolean;
  /** Mức lệch tuyệt đối (%), làm tròn 2 chữ số thập phân. */
  pct: number;
}

/** Tính lệch bằng số nguyên (micro-USD là bigint, không dùng số thực để so ngưỡng). */
export function deviationOf(ledger: bigint, invoice: bigint): Deviation {
  if (invoice === 0n) {
    return ledger === 0n ? { mismatch: false, pct: 0 } : { mismatch: true, pct: 100 };
  }
  const diff = ledger >= invoice ? ledger - invoice : invoice - ledger;
  return {
    mismatch: diff * 100n > invoice * INVOICE_MISMATCH_PERCENT,
    pct: Number((diff * 10_000n) / invoice) / 100,
  };
}

export interface ReconcileResult {
  day: string;
  providers: number;
  mismatches: number;
  missing: number;
}

export async function reconcileInvoices(at: Date = new Date()): Promise<ReconcileResult> {
  const day = reconcileDay(at);
  const providers = await invoiceProvidersForDay(day);
  let mismatches = 0;
  let missing = 0;
  for (const provider of providers) {
    const total = await invoiceLedgerTotal(provider, day);
    if (total.invoiceTotalMicroUsd === null) {
      missing++;
      gatewayEvent('info', 'ai.invoice_missing', { provider, invoice_date: day });
      continue;
    }
    const dev = deviationOf(total.ledgerTotalMicroUsd, total.invoiceTotalMicroUsd);
    if (!dev.mismatch) continue;
    mismatches++;
    gatewayEvent('warn', 'ai.invoice_mismatch', {
      provider,
      invoice_date: day,
      deviation_pct: dev.pct,
      reason: 'invoice_mismatch',
    });
  }
  return { day, providers: providers.length, mismatches, missing };
}
