import { sql } from 'drizzle-orm';
import { supportCommand } from '../../../../core/db/support';
import { systemTx } from '../../../../core/db';

// Bọc kiểu quanh các hàm TỔNG HỢP chỉ-đọc của Cổng AI (015 T068a, migration 0032). Chỉ trả số tổng hợp, không mã tài khoản.
//  - `adminCostSummary`: vai trò `support` qua `supportCommand` (không tenant, không kiểm toán xem tài khoản – FR-018).
//  - `thresholdRatio`, `invoiceLedgerTotal`, `invoiceProvidersForDay`: vai trò `system` (Worker) qua `systemTx`, `tenant: 'none'`.

export interface CostBreakdownRow {
  calls: number;
  costMicroUsd: number;
}
export interface CostSummary {
  totalMicroUsd: number;
  accounts: number;
  averagePerAccountMicroUsd: number;
  averagePerPostMicroUsd: number;
  byTask: (CostBreakdownRow & { task: string })[];
  byProvider: (CostBreakdownRow & { provider: string })[];
  byModel: (CostBreakdownRow & { provider: string; modelId: string })[];
}

export interface ThresholdRatio {
  /**
   * Số tài khoản (duy nhất) chạm ngưỡng mềm ở chu kỳ hiện hành (used + reserved ≥ soft_limit), chỉ đếm từ `ai_budgets`.
   * Mẫu số (tài khoản đang hoạt động) KHÔNG nằm ở đây: bên gọi lấy qua `AccountPublicApi.countActiveAccounts` (hiến pháp IV).
   */
  softAccounts: number;
}

export interface InvoiceLedgerTotal {
  /** Σ chi phí sổ (micro-USD) của nhà cung cấp trong ngày UTC+7; 0 nếu không có dòng. */
  ledgerTotalMicroUsd: bigint;
  ledgerRows: number;
  /** `null` khi chưa nhập hóa đơn của (nhà cung cấp, ngày). */
  invoiceTotalMicroUsd: bigint | null;
}

/** Tổng hợp chi phí theo chu kỳ (`cycleStart` = `YYYY-MM-DD`, ngày bắt đầu chu kỳ). Không dữ liệu → toàn 0 và mảng rỗng. */
export async function adminCostSummary(cycleStart: string): Promise<CostSummary> {
  const row = await supportCommand(async (db) => {
    const r = await db.execute<{ s: CostSummary }>(
      sql`SELECT ai_gateway.admin_cost_summary(${cycleStart}::date) AS s`,
    );
    return r.rows[0];
  });
  if (row === undefined) throw new Error('AI_COST_SUMMARY_EMPTY');
  return row.s;
}

/** Tỷ lệ tài khoản chạm ngưỡng mềm tại thời điểm `at` (mặc định đồng hồ ứng dụng). Chạy ở Worker. */
export async function thresholdRatio(at: Date = new Date()): Promise<ThresholdRatio> {
  const row = await systemTx(
    async (db) =>
      (
        await db.execute<{ soft_accounts: string | number }>(
          sql`SELECT * FROM ai_gateway.threshold_ratio(${at.toISOString()}::timestamptz)`,
        )
      ).rows[0],
    { tenant: 'none' },
  );
  return { softAccounts: Number(row?.soft_accounts ?? 0) };
}

/** Σ sổ + hóa đơn của (nhà cung cấp, ngày UTC+7 `YYYY-MM-DD`). Luôn trả một kết quả. */
export async function invoiceLedgerTotal(
  provider: string,
  day: string,
): Promise<InvoiceLedgerTotal> {
  const row = await systemTx(
    async (db) =>
      (
        await db.execute<{
          ledger_total: string | number;
          ledger_rows: string | number;
          has_invoice: boolean;
          invoice_total: string | number | null;
        }>(sql`SELECT * FROM ai_gateway.invoice_ledger_total(${provider}, ${day}::date)`)
      ).rows[0],
    { tenant: 'none' },
  );
  return {
    ledgerTotalMicroUsd: BigInt(row?.ledger_total ?? 0),
    ledgerRows: Number(row?.ledger_rows ?? 0),
    invoiceTotalMicroUsd:
      row?.has_invoice === true && row.invoice_total !== null ? BigInt(row.invoice_total) : null,
  };
}

export interface OpenReservationsCount {
  /** Giữ chỗ chưa đóng (held/calling) của mọi tài khoản (tổng, không theo tài khoản). */
  tenantOpen: number;
  /** Giữ chỗ hệ thống chưa đóng. */
  systemOpen: number;
}

/** Số giữ chỗ chưa đóng toàn hệ thống (migration 0033) – nguồn gauge `ai_gateway_open_reservations` ở Worker. */
export async function openReservationsCount(): Promise<OpenReservationsCount> {
  const row = await systemTx(
    async (db) =>
      (
        await db.execute<{ tenant_open: string | number; system_open: string | number }>(
          sql`SELECT * FROM ai_gateway.open_reservations_count()`,
        )
      ).rows[0],
    { tenant: 'none' },
  );
  return { tenantOpen: Number(row?.tenant_open ?? 0), systemOpen: Number(row?.system_open ?? 0) };
}

/** Nhà cung cấp cần đối soát trong ngày (có dòng sổ hoặc có hóa đơn). */
export async function invoiceProvidersForDay(day: string): Promise<string[]> {
  const rows = await systemTx(
    async (db) =>
      (
        await db.execute<{ provider: string }>(
          sql`SELECT provider FROM ai_gateway.invoice_providers_for_day(${day}::date)`,
        )
      ).rows,
    { tenant: 'none' },
  );
  return rows.map((r) => r.provider);
}
