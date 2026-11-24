import { randomBytes } from 'node:crypto';
import { setGatewayLogSink, type GatewayLogEntry } from '../../../src/core/gateways/op-log';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { asOwner } from '../../db/helpers/db';

// Dữ liệu mồi + bộ bắt nhật ký cho kiểm thử cảnh báo vận hành Cổng AI (015 US8, T064; FR-034, SC-013).
//
// Tỷ lệ "tài khoản chạm ngưỡng mềm / tài khoản hoạt động" là số liệu TOÀN HỆ THỐNG nên chịu ảnh hưởng của mọi tài khoản
// do ca khác tạo trong cùng CSDL thử. Cách giữ ca tất định: đo mốc nền (baseline) bằng owner rồi THÊM tài khoản (hàng loạt)
// để ép tỷ lệ về đúng vùng mong muốn, xong dọn lại. Định nghĩa "đang hoạt động" chưa chốt tuyệt đối (research R-14: `status <>
// 'unclaimed'`; có thể chặt hơn `status = 'active'`), nên mọi hình dạng đều thỏa với CẢ HAI cách đếm (xấu nhất cho từng ca).

/** Ngày hôm nay theo giờ Việt Nam (`YYYY-MM-DD`) theo đồng hồ CSDL. */
export async function localToday(): Promise<string> {
  return asOwner(
    async (c) =>
      (
        await c.query<{ d: string }>(
          "SELECT to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d",
        )
      ).rows[0]!.d,
  );
}

/** Cộng `days` ngày vào ngày `YYYY-MM-DD` (UTC thuần, không lệch múi giờ). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Bắt nhật ký cổng (`gatewayEvent`) – cảnh báo vận hành là dòng nhật ký có cấu trúc mức `warn`.
// ---------------------------------------------------------------------------------------------------------------

export interface EventCapture {
  entries: GatewayLogEntry[];
  named: (msg: string) => GatewayLogEntry[];
  clear: () => void;
  stop: () => void;
}

export function captureGatewayLog(): EventCapture {
  const entries: GatewayLogEntry[] = [];
  setGatewayLogSink({
    write: (entry) => {
      entries.push(entry);
    },
  });
  return {
    entries,
    named: (msg) => entries.filter((e) => e.msg === msg),
    clear: () => {
      entries.length = 0;
    },
    stop: () => {
      setGatewayLogSink(undefined);
    },
  };
}

/** Chữ ký so sánh giữa hai lần chạy: bỏ trường thay đổi theo lượt (mã theo dõi, thời gian). */
export function signature(entries: GatewayLogEntry[]): unknown[] {
  return entries.map((e) => {
    const copy: Record<string, unknown> = { ...e };
    delete copy.trace_id;
    delete copy.duration_ms;
    return copy;
  });
}

/** Khóa tên chứa tiền / số liệu theo tài khoản – cảnh báo gửi vận hành KHÔNG được mang (hiến chương III, FR-034). */
export const MONEY_OR_ACCOUNT_KEY = /(micro|usd|cost|amount|used|reserved|cap\b|balance|account)/i;

// ---------------------------------------------------------------------------------------------------------------
// Dân số tài khoản và hình dạng tỷ lệ.
// ---------------------------------------------------------------------------------------------------------------

export interface Population {
  /** Tài khoản hoạt động theo cách đếm chặt (`status = 'active'`) và rộng (`status <> 'unclaimed'`). */
  tMin: number;
  tMax: number;
  /** Số tài khoản (trong tập tương ứng) có dòng ngân sách chu kỳ hiện hành với used + reserved ≥ soft_limit. */
  sMin: number;
  sMax: number;
}

export async function population(): Promise<Population> {
  const row = await asOwner(
    async (c) =>
      (
        await c.query<Record<keyof Population, string>>(
          `WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today),
                a AS (
                  SELECT acc.id, acc.status,
                         EXISTS (SELECT 1 FROM ai_gateway.ai_budgets b, d
                                  WHERE b.account_id = acc.id AND b.cycle_start <= d.today AND b.cycle_end > d.today
                                    AND b.used + b.reserved >= b.soft_limit) AS soft
                    FROM account.accounts acc WHERE acc.status <> 'unclaimed')
           SELECT count(*) FILTER (WHERE status = 'active')::text AS "tMin",
                  count(*)::text AS "tMax",
                  count(*) FILTER (WHERE status = 'active' AND soft)::text AS "sMin",
                  count(*) FILTER (WHERE soft)::text AS "sMax"
             FROM a`,
        )
      ).rows[0]!,
  );
  return {
    tMin: Number(row.tMin),
    tMax: Number(row.tMax),
    sMin: Number(row.sMin),
    sMax: Number(row.sMax),
  };
}

export interface Shape {
  /** Tài khoản active có ngân sách chu kỳ hiện hành đạt ngưỡng mềm (xen kẽ used và used+reserved). */
  soft: number;
  /** Tài khoản active, một nửa có ngân sách ngay dưới ngưỡng mềm (soft − 1), một nửa không có dòng ngân sách. */
  plain: number;
  /** Tài khoản chờ (`unclaimed`) – KHÔNG được tính vào mẫu số, dù có dòng ngân sách đạt ngưỡng. */
  unclaimed?: number;
  /** Tài khoản active có ngân sách đã đạt ngưỡng nhưng ở chu kỳ ĐÃ KẾT THÚC – không tính vào tử số. */
  staleSoft?: number;
}

/** Thêm tài khoản theo hình dạng; trả hàm dọn (xóa tài khoản + ngân sách đã thêm). */
export async function addAccounts(shape: Shape): Promise<() => Promise<void>> {
  const today = await localToday();
  const ids: string[] = [];
  const statuses: string[] = [];
  const budgets: {
    id: string;
    accountId: string;
    start: string;
    end: string;
    used: number;
    reserved: number;
  }[] = [];
  const current = { start: addDays(today, -5), end: addDays(today, 25) };
  const ended = { start: addDays(today, -40), end: addDays(today, -10) };

  const add = (
    status: string,
    budget?: { start: string; end: string; used: number; reserved: number },
  ) => {
    const id = uuidV7();
    ids.push(id);
    statuses.push(status);
    if (budget !== undefined) budgets.push({ id: uuidV7(), accountId: id, ...budget });
  };

  for (let i = 0; i < shape.soft; i++) {
    add('active', {
      ...current,
      ...(i % 3 === 2
        ? { used: 1_000_000, reserved: 1_000_000 }
        : { used: 2_000_000, reserved: 0 }),
    });
  }
  for (let i = 0; i < shape.plain; i++) {
    if (i % 2 === 0) add('active', { ...current, used: 1_999_999, reserved: 0 });
    else add('active');
  }
  for (let i = 0; i < (shape.unclaimed ?? 0); i++) {
    add('unclaimed', { ...current, used: 2_000_000, reserved: 0 });
  }
  for (let i = 0; i < (shape.staleSoft ?? 0); i++) {
    add('active', { ...ended, used: 2_000_000, reserved: 0 });
  }

  await asOwner(async (c) => {
    if (ids.length === 0) return;
    await c.query(
      'INSERT INTO account.accounts (id, status) SELECT * FROM unnest($1::uuid[], $2::text[])',
      [ids, statuses],
    );
    if (budgets.length === 0) return;
    await c.query(
      `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, used, reserved, cap, soft_limit)
       SELECT id, account_id, cs, ce, used, reserved, 4000000, 2000000
         FROM unnest($1::uuid[], $2::uuid[], $3::date[], $4::date[], $5::bigint[], $6::bigint[])
              AS t(id, account_id, cs, ce, used, reserved)`,
      [
        budgets.map((b) => b.id),
        budgets.map((b) => b.accountId),
        budgets.map((b) => b.start),
        budgets.map((b) => b.end),
        budgets.map((b) => b.used),
        budgets.map((b) => b.reserved),
      ],
    );
  });

  return async () => {
    await asOwner(async (c) => {
      await c.query('DELETE FROM ai_gateway.ai_budgets WHERE account_id = ANY($1)', [ids]);
      await c
        .query('DELETE FROM account.accounts WHERE id = ANY($1)', [ids])
        // Không xóa được (ràng buộc khác) → loại khỏi mọi phép đếm bằng trạng thái chờ.
        .catch(() =>
          c.query("UPDATE account.accounts SET status = 'unclaimed' WHERE id = ANY($1)", [ids]),
        );
    });
  };
}

/** Số tài khoản `soft` cần thêm để tỷ lệ ≥ `pct` ở trường hợp xấu nhất (sMin / tMax). */
export function softToReach(p: Population, pct: number): number {
  const ratio = pct / 100;
  return Math.max(0, Math.ceil((ratio * p.tMax - p.sMin) / (1 - ratio)));
}

/**
 * Ép tỷ lệ tài khoản chạm ngưỡng ≈ `pct`% hoặc nhỉnh hơn (tuyệt đối ≥ pct ở cả hai cách đếm). Trả hàm dọn.
 */
export async function shapeAtLeast(pct: number): Promise<() => Promise<void>> {
  const p = await population();
  return addAccounts({ soft: softToReach(p, pct) + 1, plain: 0 });
}

/**
 * Ép tỷ lệ ≤ `pct`% ở cả hai cách đếm (xấu nhất sMax / tMin), rồi đẩy lên sát `pct` bằng tài khoản đạt ngưỡng để ca "4%"
 * thật sự gần 4% chứ không phải 0%. Trả hàm dọn.
 */
export async function shapeAtMost(pct: number): Promise<() => Promise<void>> {
  const p = await population();
  const ratio = pct / 100;
  // Mẫu số đủ lớn: (sMax + a) / (tMin + a + b) ≤ ratio.
  const plain = Math.max(0, Math.ceil(p.sMax / ratio) - p.tMin);
  const total = p.tMin + plain;
  const soft = Math.max(0, Math.floor((ratio * total - p.sMax) / (1 - ratio)));
  return addAccounts({ soft, plain });
}

/**
 * Ép tỷ lệ đúng 5% (ranh giới, KHÔNG được cảnh báo vì quy tắc là "> 5%"). Chỉ dựng được khi hai cách đếm trùng nhau
 * (`tMin = tMax`, `sMin = sMax`); ngược lại trả `null` để ca bỏ qua.
 */
export async function shapeExactlyFivePercent(): Promise<(() => Promise<void>) | null> {
  const p = await population();
  if (p.tMin !== p.tMax || p.sMin !== p.sMax) return null;
  const k = Math.max(1, p.sMax, Math.ceil((p.tMax - p.sMax) / 19));
  const soft = k - p.sMax;
  const plain = 19 * k - p.tMax + p.sMax;
  return addAccounts({ soft, plain });
}

// ---------------------------------------------------------------------------------------------------------------
// Sổ chi phí + hóa đơn nhà cung cấp (đối soát).
// ---------------------------------------------------------------------------------------------------------------

export const uniqueProvider = (): string => `qa-prov-${randomBytes(5).toString('hex')}`;

/**
 * Ngày đối soát của lần chạy hiện tại: "ngày hôm trước" theo giờ Việt Nam (việc chạy 02:00 UTC+7 đối soát ngày trước đó).
 */
export async function reconcileDate(): Promise<string> {
  return addDays(await localToday(), -1);
}

/** Phân vùng sổ chi phí chứa `date` (bản dựng CSDL chỉ tạo tháng hiện tại + 2 tháng sau; ngày đầu tháng cần tháng trước). */
export async function ensureLedgerPartition(date: string): Promise<void> {
  const first = `${date.slice(0, 7)}-01`;
  const next = addDays(`${first.slice(0, 7)}-28`, 5).slice(0, 7) + '-01';
  const name = `ai_cost_ledger_y${first.slice(0, 4)}m${first.slice(5, 7)}`;
  await asOwner(async (c) => {
    const exists = await c.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [
      `ai_gateway.${name}`,
    ]);
    if (exists.rows[0]!.r !== null) return;
    await c.query(
      `CREATE TABLE ai_gateway.${name} PARTITION OF ai_gateway.ai_cost_ledger
         FOR VALUES FROM ('${first}T00:00:00Z') TO ('${next}T00:00:00Z')`,
    );
    await c.query(`ALTER TABLE ai_gateway.${name} ENABLE ROW LEVEL SECURITY`);
  });
}

/**
 * Chèn dòng sổ (nhà cung cấp `provider`, ngày `date` theo giờ VN) – mỗi phần tử `costs` là một lời gọi của MỘT tài khoản
 * ngẫu nhiên (sổ không khóa ngoại). Thời điểm đặt 12:00 UTC (= 19:00 UTC+7) nên cùng một ngày ở cả hai múi giờ.
 * Trả mã tài khoản đã dùng (để kiểm không lộ trong cảnh báo).
 */
export async function seedLedger(
  provider: string,
  date: string,
  costs: number[],
): Promise<string[]> {
  await ensureLedgerPartition(date);
  const accounts = costs.map(() => uuidV7());
  await asOwner(async (c) => {
    for (const [i, cost] of costs.entries()) {
      await c.query(
        `INSERT INTO ai_gateway.ai_cost_ledger
           (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
            cost_micro_usd, estimate_micro_usd, created_at)
         VALUES ($1, $2, $3::date, $4, 'post_generation', 'default', 'qa-model', $5, $6, $6, $7::timestamptz)`,
        [uuidV7(), accounts[i], date, uuidV7(), provider, cost, `${date}T12:00:00Z`],
      );
    }
  });
  return accounts;
}

export async function setInvoice(provider: string, date: string, total: number): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO ai_gateway.provider_invoices (id, provider, invoice_date, total_micro_usd, entered_by)
       VALUES ($1, $2, $3::date, $4, 'qa-test')
       ON CONFLICT (provider, invoice_date) DO UPDATE SET total_micro_usd = EXCLUDED.total_micro_usd`,
      [uuidV7(), provider, date, total],
    ),
  );
}

export async function cleanupProvider(provider: string): Promise<void> {
  await asOwner(async (c) => {
    await c.query('DELETE FROM ai_gateway.ai_cost_ledger WHERE provider = $1', [provider]);
    await c.query('DELETE FROM ai_gateway.provider_invoices WHERE provider = $1', [provider]);
  });
}

/** Ảnh chụp tổng hợp dữ liệu liên quan (chạy lại hai lần không được đổi dữ liệu). */
export async function dataFingerprint(provider?: string): Promise<Record<string, string>> {
  return asOwner(
    async (c) =>
      (
        await c.query<Record<string, string>>(
          `SELECT (SELECT count(*) FROM ai_gateway.ai_budgets)::text AS budgets,
                  (SELECT COALESCE(sum(used + reserved), 0) FROM ai_gateway.ai_budgets)::text AS budget_sum,
                  (SELECT count(*) FROM ai_gateway.ai_cost_ledger WHERE ($1::text IS NULL OR provider = $1))::text AS ledger,
                  (SELECT count(*) FROM ai_gateway.provider_invoices WHERE ($1::text IS NULL OR provider = $1))::text AS invoices`,
          [provider ?? null],
        )
      ).rows[0]!,
  );
}
