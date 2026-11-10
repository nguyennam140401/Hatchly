// Nạp matcher DOM của Testing Library (toBeInTheDocument, toHaveAttribute…).
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// Matcher trợ năng `toHaveNoViolations` (SC-009, WCAG 2.1 AA) – dùng cùng `axe(container)`.
expect.extend(axeMatchers);

// Vitest 5 cho mở rộng qua `Matchers<R, T>`; tham số kiểu phải trùng khai báo gốc.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R;
  }
}
