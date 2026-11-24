import type { ConnectionConsumersPort } from '../../public-api';

// Bộ đăng ký cổng ngược (010 R7, contracts/platform-gateway-public-api.md mục 3). `publishing` gọi
// `registerConnectionConsumers` ở `onModuleInit`; `platform_gateway` đọc qua `connectionConsumers()`.
// Chưa đăng ký (chỉ chạy 010 hoặc kiểm thử cổng) → bản rỗng: không có bài, không hủy gì, không có ánh xạ lỗi.

const EMPTY: ConnectionConsumersPort = {
  scheduledImpact: (ids) =>
    Promise.resolve(new Map(ids.map((id) => [id, { count: 0, nextAt: null }]))),
  onDisconnect: () => Promise.resolve({ cancelled: 0 }),
  errorMappings: () => Promise.resolve([]),
};

let registered: ConnectionConsumersPort | undefined;

/** Đăng ký bản cài đặt (gọi lại = thay thế; dùng trong kiểm thử). */
export function registerConnectionConsumers(port: ConnectionConsumersPort): void {
  registered = port;
}

/** Bản đã đăng ký hoặc bản rỗng. */
export function connectionConsumers(): ConnectionConsumersPort {
  return registered ?? EMPTY;
}

/** Chỉ kiểm thử: bỏ đăng ký. */
export function resetConnectionConsumers(): void {
  registered = undefined;
}
