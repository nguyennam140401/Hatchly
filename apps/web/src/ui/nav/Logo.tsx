import { cn } from '../util/cn';

/** Biểu trưng 32×32 (tạm – thay bằng SVG Figma khi có). Trang trí: tên ứng dụng đứng cạnh nó ở TopBar. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn('size-8 shrink-0 text-brand', className)}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M9 17l5 5 9-11"
        fill="none"
        stroke="var(--color-on-brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
