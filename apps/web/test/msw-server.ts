import { setupServer } from 'msw/node';

/** Máy chủ giả dùng chung: kiểm thử gọi `server.use(http.get(...))` để khai báo phản hồi. */
export const server = setupServer();
