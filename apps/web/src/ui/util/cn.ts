import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Ghép tên lớp: `clsx` rồi gộp lớp Tailwind xung đột (lớp sau thắng). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
