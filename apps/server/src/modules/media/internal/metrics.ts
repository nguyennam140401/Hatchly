// Chỉ số của Thư viện media (014 plan.md "Quan sát", hiến pháp VIII) qua OpenTelemetry API – no-op cho tới khi có SDK.
// Nhãn CHỈ gồm giá trị có số lượng nhỏ cố định (`result`, `kind`) – KHÔNG BAO GIỜ có `account_id`, `media_id`, tên tệp, URL
// (tránh bùng kích thước chuỗi thời gian và rò dữ liệu; tra từng tài khoản bằng nhật ký có cấu trúc).
//
// Tên Prometheus (bộ đếm thêm `_total`, histogram có `unit: 's'` thêm `_seconds`):
//   media_uploads_total{result}              started | completed | rejected | cancelled | expired
//   media_processed_total{result}            ready | unprocessable | duplicate  (mẫu số của tỷ lệ "không xử lý được")
//   media_process_duration_seconds{kind}     image | video (từ lúc Worker nhận việc đến lúc đặt ready)
//   media_storage_bytes_by_kind{kind}        thay đổi dung lượng tệp gốc theo loại (+ khi ready, − khi xóa/mất tệp)
//   media_quota_drift_total                  độ lệch bộ đếm dung lượng đã sửa, tính bằng byte (do `media.cleanup` full)
import { metrics, type Counter, type Histogram, type UpDownCounter } from '@opentelemetry/api';

export type UploadResult = 'started' | 'completed' | 'rejected' | 'cancelled' | 'expired';
export type ProcessResult = 'ready' | 'unprocessable' | 'duplicate';
export type MediaKindLabel = 'image' | 'video';

interface Instruments {
  uploads: Counter;
  processed: Counter;
  duration: Histogram;
  storage: UpDownCounter;
  drift: Counter;
}

let cached: Instruments | undefined;

/** Tạo muộn (lần ghi đầu) để chọn đúng MeterProvider đã đăng ký. */
function get(): Instruments {
  if (cached !== undefined) return cached;
  const meter = metrics.getMeter('app.media');
  cached = {
    uploads: meter.createCounter('media_uploads_total', {
      description: 'Số lần tải lên theo kết quả',
    }),
    processed: meter.createCounter('media_processed_total', {
      description: 'Số media được Worker xử lý xong theo kết quả',
    }),
    duration: meter.createHistogram('media_process_duration_seconds', {
      unit: 's',
      description: 'Thời gian Worker xử lý một media (giây)',
      advice: { explicitBucketBoundaries: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600] },
    }),
    storage: meter.createUpDownCounter('media_storage_bytes_by_kind', {
      description: 'Thay đổi dung lượng tệp gốc theo loại (byte)',
    }),
    drift: meter.createCounter('media_quota_drift_total', {
      description: 'Độ lệch bộ đếm dung lượng đã sửa (byte)',
    }),
  };
  return cached;
}

export function recordUpload(result: UploadResult): void {
  get().uploads.add(1, { result });
}

export function recordProcessed(result: ProcessResult, kind?: MediaKindLabel, seconds?: number): void {
  const m = get();
  m.processed.add(1, { result });
  if (result === 'ready' && kind !== undefined && seconds !== undefined) {
    m.duration.record(seconds, { kind });
  }
}

export function recordStorageBytes(kind: MediaKindLabel, deltaBytes: number): void {
  if (deltaBytes !== 0) get().storage.add(deltaBytes, { kind });
}

export function recordQuotaDrift(bytes: number): void {
  if (bytes > 0) get().drift.add(bytes);
}
