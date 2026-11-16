import { http, HttpResponse } from 'msw';
import { respondTo, type Scenario } from '../fixtures/scenarios';

// Máy chủ giả MSW cho kiểm thử: `GET /api/_catalog/items?scenario=…` trả đúng 5 tình huống của mô hình trạng thái hiển thị.
export const CATALOG_URL = 'http://localhost/api/_catalog/items';

export const catalogHandlers = [
  http.get(CATALOG_URL, ({ request }) => {
    const scenario = new URL(request.url).searchParams.get('scenario') as Scenario | null;
    if (scenario === 'error') {
      return HttpResponse.json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
            actions: [{ kind: 'retry', label: 'Thử lại' }],
            support: { traceId: 'trace-msw', detail: 'SERVICE_UNAVAILABLE' },
          },
        },
        { status: 503 },
      );
    }
    return HttpResponse.json(respondTo(scenario ?? 'ok'));
  }),
];
