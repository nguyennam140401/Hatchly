import { gatewayEvent as emit, type GatewayLogLevel } from '../../../core/gateways/op-log';
import { GATEWAY_EVENT_NAMES } from './event-names';
import { recordGatewayEvent } from './metrics';

// Sự kiện vận hành của Cổng AI (015, contracts/jobs-and-alerts.md mục 2): nhật ký có cấu trúc mức `info|warn|error`
// → quy tắc cảnh báo đặt ở cấu hình giám sát. CHỈ nhận các trường định danh/đếm ở danh sách dưới – KHÔNG nhận lời
// nhắc, văn bản kết quả hay số tiền theo tài khoản (kiểu từ chối ở biên dịch, và lớp nhật ký lõi cũng lọc khóa lạ).

export type GatewayEventName =
  | 'ai.threshold_ratio_high'
  | 'ai.invoice_mismatch'
  | 'ai.invoice_missing'
  | 'ai.unsettled_reservation'
  | 'ai.cost_anomaly'
  | 'ai.settle_failed'
  | 'ai.price_missing'
  | 'ai.route_missing'
  | 'ai.system_budget_exhausted'
  | 'ai.industry_source_missing'
  | 'ai.provider_error';

// Ép khớp hai chiều giữa kiểu trên và danh sách khởi tạo mẫu 0 (thiếu/thừa tên ⇒ lỗi biên dịch).
type ListedName = (typeof GATEWAY_EVENT_NAMES)[number];
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const EVENT_NAMES_IN_SYNC: Equal<GatewayEventName, ListedName> = true;

/** Mã lý do cố định – không nhận chuỗi tự do để thông điệp lỗi nhà cung cấp không lọt vào nhật ký. */
export type GatewayEventReason =
  | 'price_not_found'
  | 'route_not_found'
  | 'budget_exhausted'
  | 'system_budget_exhausted'
  | 'cap_reached'
  | 'provider_failed'
  | 'provider_timeout'
  | 'settle_failed'
  | 'industry_source_missing'
  | 'invoice_mismatch'
  | 'cost_anomaly'
  | 'adapter_missing'
  | 'missing_usage'
  | 'unknown';

/** Trường được phép (khớp `SAFE_ATTR_KEYS` của lõi); giá trị chỉ là chuỗi ngắn, số hoặc boolean. */
export interface GatewayEventFields {
  task?: string;
  model_tier?: string;
  model_id?: string;
  provider?: string;
  tier?: string;
  status?: string | number;
  /** Loại lỗi nhà cung cấp đã chuẩn hóa (tập cố định). */
  kind?: string;
  reason?: GatewayEventReason;
  count?: number;
  attempt?: number;
  fallback?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  week_start?: string;
  cycle_start?: string;
  /** Ngày hóa đơn đối soát `YYYY-MM-DD`. */
  invoice_date?: string;
  /** Mức lệch tuyệt đối (%) giữa Σ sổ và hóa đơn. */
  deviation_pct?: number;
}

export function gatewayEvent(
  level: GatewayLogLevel,
  name: GatewayEventName,
  fields: GatewayEventFields = {},
): void {
  emit(level, name, { ...fields });
  recordGatewayEvent(name);
}
