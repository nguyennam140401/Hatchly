import { AppError } from '../../lib/api/errors';

// Năm tình huống chuẩn của mô hình trạng thái hiển thị (Story 5): tải, trống, lỗi, khóa, một phần. Dùng chung cho spec,
// danh mục và màn hình mẫu; không phụ thuộc máy chủ thật.

export const SCENARIOS = ['loading', 'empty', 'error', 'locked', 'partial', 'ok'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface SampleItem {
  id: string;
  title: string;
  excerpt: string;
  status: string;
  channels: string[];
}

export interface SampleResponse {
  items: SampleItem[];
  locked?: { reason: string; reopensAt: string };
  partial?: { done: number; attention: number };
}

export const SAMPLE_ITEMS: SampleItem[] = [
  {
    id: 's1',
    title: 'Khuyến mãi cuối tuần',
    excerpt: 'Giảm 10% cho khách quen.',
    status: 'scheduled',
    channels: ['facebook'],
  },
  {
    id: 's2',
    title: 'Giới thiệu sản phẩm mới',
    excerpt: 'Bộ sưu tập mùa thu đã về.',
    status: 'published',
    channels: ['facebook', 'instagram'],
  },
  {
    id: 's3',
    title: 'Cảm ơn khách hàng',
    excerpt: 'Một lời cảm ơn nhỏ.',
    status: 'attention',
    channels: ['tiktok'],
  },
];

export const SAMPLE_ERROR = () =>
  new AppError({
    kind: 'server',
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
    support: { traceId: 'trace-catalog' },
  });

/** Phản hồi giả theo tình huống (dùng trực tiếp trong danh mục, không qua mạng). */
export function respondTo(scenario: Scenario): SampleResponse {
  switch (scenario) {
    case 'empty':
      return { items: [] };
    case 'locked':
      return {
        items: [],
        locked: {
          reason: 'Đã dùng hết lượt AI trong chu kỳ này.',
          reopensAt: '2026-12-01T00:00:00Z',
        },
      };
    case 'partial':
      return { items: SAMPLE_ITEMS, partial: { done: 2, attention: 1 } };
    default:
      return { items: SAMPLE_ITEMS };
  }
}

/** Lấy dữ liệu theo tình huống: `error` ném `AppError`; `loading` không bao giờ xong. */
export function fetchScenario(scenario: Scenario): Promise<SampleResponse> {
  if (scenario === 'loading') return new Promise<SampleResponse>(() => undefined);
  if (scenario === 'error') return Promise.reject(SAMPLE_ERROR());
  return Promise.resolve(respondTo(scenario));
}
