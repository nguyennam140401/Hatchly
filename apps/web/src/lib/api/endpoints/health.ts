import { HealthResponse } from '@app/shared/core';
import { apiClient, type ResponseSchema } from '../client';

// Điểm cuối kiểm tra sống của API (`GET /healthz`). Chỉ chấp nhận phản hồi từ đơn vị API, không phải cổng kiểm tra sống
// của Worker. Đường dẫn API chỉ khai báo ở thư mục `endpoints/` (FR-029).

const apiHealth: ResponseSchema<HealthResponse> = {
  safeParse(value) {
    const parsed = HealthResponse.safeParse(value);
    return parsed.success && parsed.data.unit === 'api'
      ? { success: true, data: parsed.data }
      : { success: false };
  },
};

export const healthApi = {
  get: (opts: { signal?: AbortSignal } = {}) =>
    apiClient.request('GET', '/healthz', { schema: apiHealth, silentAuth: true, ...opts }),
};
