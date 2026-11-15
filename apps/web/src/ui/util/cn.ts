import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Báo cho tailwind-merge biết các cỡ chữ/khoảng cách/bo góc riêng của bộ giá trị thiết kế; nếu không, `text-body` bị coi
// là MÀU chữ và bị `text-ink` ghi đè (mất cỡ chữ).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'title', 'heading', 'body', 'body-sm', 'label', 'caption'],
      spacing: ['touch', 'topbar', 'navbar', 'sidebar', 'gutter', 'phone'],
      radius: ['sm', 'md', 'lg', 'pill'],
    },
  },
});

/** Ghép tên lớp: `clsx` rồi gộp lớp Tailwind xung đột (lớp sau thắng). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
