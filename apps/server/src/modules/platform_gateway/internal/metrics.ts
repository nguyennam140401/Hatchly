// Chỉ số của Cổng nền tảng (010 T064, contracts/jobs-and-notifications.md mục 4, hiến pháp VIII) qua OpenTelemetry API –
// no-op cho tới khi có SDK. Nhãn CHỈ gồm giá trị có số lượng nhỏ cố định (`state`, `channel_type`, `result`) – KHÔNG BAO GIỜ có
// `account_id`, `connection_id`, tên Page (tránh bùng kích thước chuỗi thời gian và rò dữ liệu; tra từng tài khoản bằng nhật ký).
//
// Tên Prometheus (bộ đếm thêm `_total`):
//   channel_connections{state,channel_type}       gauge: số kênh theo trạng thái lưu (qua `channel_stats()`, không mã tài khoản)
//   channel_expiring_lt7d{channel_type}           gauge: số kênh còn quyền < 7 ngày (cùng ngưỡng nhắc – cảnh báo vận hành)
//   channel_refresh_total{channel_type,result}    ok | deferred | failed (mẫu số của tỷ lệ làm mới thành công – SC-005)
//   channel_connect_total{channel_type,result}    created | thất bại theo nguyên nhân (outcome của `confirm`/mã lỗi gọi lại)
//   channel_feature_read_failed_total             công tắc không đọc được (phải ≈ 0)
// Cảnh báo: tỷ lệ làm mới lỗi > 5%/giờ; `channel_feature_read_failed_total` > 0 kéo dài 10 phút; `channel_expiring_lt7d` > 0.
import { metrics, type Counter } from '@opentelemetry/api';
import { sql } from 'drizzle-orm';
import { systemTx } from '../../../core';

export type RefreshResult = 'ok' | 'deferred' | 'failed';

interface Instruments {
  refresh: Counter;
  connect: Counter;
  featureReadFailed: Counter;
}

let cached: Instruments | undefined;

/** Tạo muộn (lần ghi đầu) để chọn đúng MeterProvider đã đăng ký. */
function get(): Instruments {
  if (cached !== undefined) return cached;
  const meter = metrics.getMeter('app.platform_gateway');
  cached = {
    refresh: meter.createCounter('channel_refresh_total', {
      description: 'Số lần kiểm tra/làm mới quyền kênh theo kết quả',
    }),
    connect: meter.createCounter('channel_connect_total', {
      description: 'Số lần kết nối kênh theo kết quả/nguyên nhân thất bại',
    }),
    featureReadFailed: meter.createCounter('channel_feature_read_failed_total', {
      description: 'Số lần không đọc được công tắc tính năng (đã coi là tắt)',
    }),
  };
  return cached;
}

/** `result` của `check_connection`: `ok`/`changed` ⇒ ok; `deferred` ⇒ deferred; còn lại (lỗi hạ tầng) do bên gọi ghi `failed`. */
export function recordRefresh(channelType: string, result: RefreshResult): void {
  get().refresh.add(1, { channel_type: channelType, result });
}

export function recordConnect(channelType: string, result: string): void {
  get().connect.add(1, { channel_type: channelType, result });
}

export function recordFeatureReadFailed(): void {
  get().featureReadFailed.add(1);
}

interface StatRow {
  channel_type: string;
  status: string;
  total: string | number;
  expiring_lt7d: string | number;
}

/**
 * Đăng ký hai gauge quan sát, đọc `platform_gateway.channel_stats()` (SECURITY DEFINER, chỉ số đếm theo loại × trạng thái,
 * không mã tài khoản) khi bộ thu thập lấy mẫu. CHỈ gọi ở Worker (có bể `system`). Lỗi đọc ⇒ bỏ qua lần lấy mẫu đó.
 */
export function registerChannelGauges(read: () => Promise<StatRow[]> = defaultRead): () => void {
  const meter = metrics.getMeter('app.platform_gateway');
  const connections = meter.createObservableGauge('channel_connections', {
    description: 'Số kênh kết nối theo trạng thái lưu và loại kênh',
  });
  const expiring = meter.createObservableGauge('channel_expiring_lt7d', {
    description: 'Số kênh còn quyền dưới 7 ngày',
  });
  const callback = async (
    result: Parameters<Parameters<typeof meter.addBatchObservableCallback>[0]>[0],
  ): Promise<void> => {
    let rows: StatRow[];
    try {
      rows = await read();
    } catch {
      return;
    }
    const expiringByType = new Map<string, number>();
    for (const r of rows) {
      result.observe(connections, Number(r.total), {
        state: r.status,
        channel_type: r.channel_type,
      });
      expiringByType.set(
        r.channel_type,
        (expiringByType.get(r.channel_type) ?? 0) + Number(r.expiring_lt7d),
      );
    }
    for (const [channelType, n] of expiringByType) {
      result.observe(expiring, n, { channel_type: channelType });
    }
  };
  meter.addBatchObservableCallback(callback, [connections, expiring]);
  return () => {
    meter.removeBatchObservableCallback(callback, [connections, expiring]);
  };
}

async function defaultRead(): Promise<StatRow[]> {
  return systemTx(
    async (db) =>
      (
        await db.execute<StatRow & Record<string, unknown>>(
          sql`SELECT * FROM platform_gateway.channel_stats()`,
        )
      ).rows,
    { tenant: 'none' },
  );
}
