// Nạp matcher DOM của Testing Library (toBeInTheDocument, toHaveAttribute…).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { server } from './msw-server';

// Matcher trợ năng `toHaveNoViolations` (SC-009, WCAG 2.1 AA) – dùng cùng `axe(container)`.
expect.extend(axeMatchers);

// Vitest 5 cho mở rộng qua `Matchers<R, T>`; tham số kiểu phải trùng khai báo gốc.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R;
  }
}

// MSW (011): máy chủ giả cho kiểm thử mới. Kiểm thử cũ (004/006/009) vẫn thay `fetch` bằng `vi.stubGlobal`
// nên không bị ảnh hưởng; yêu cầu không có handler chỉ cảnh báo, không làm hỏng kiểm thử.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'bypass' });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

// jsdom không có canvas; axe thử gọi `getContext` khi kiểm tương phản → tắt để khỏi tràn cảnh báo.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
