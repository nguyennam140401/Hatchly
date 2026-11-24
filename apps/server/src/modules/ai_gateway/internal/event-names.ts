// Danh sách tên sự kiện vận hành `ai.*` dùng để khởi tạo mẫu 0 của bộ đếm `ai_gateway_events_total` (tách riêng để
// `events.ts` ↔ `metrics.ts` không tạo vòng phụ thuộc). `events.ts` ép khớp hai chiều với kiểu `GatewayEventName`.
export const GATEWAY_EVENT_NAMES = [
  'ai.threshold_ratio_high',
  'ai.invoice_mismatch',
  'ai.invoice_missing',
  'ai.unsettled_reservation',
  'ai.cost_anomaly',
  'ai.settle_failed',
  'ai.price_missing',
  'ai.route_missing',
  'ai.system_budget_exhausted',
  'ai.industry_source_missing',
  'ai.provider_error',
] as const;
