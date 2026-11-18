import type { ComponentType, SVGProps } from 'react';
import { cn } from '../util/cn';

// 26 biểu tượng từ Figma (tập đóng). Tệp SVG nằm ở ./svg/<tên>.svg, dùng `currentColor`, tải bằng svgr.
export const ICON_NAMES = [
  'check',
  'clock',
  'calendar',
  'send',
  'alert',
  'bulb',
  'info',
  'home',
  'list',
  'more',
  'plus',
  'image',
  'refresh',
  'copy',
  'back',
  'bell',
  'download',
  'film',
  'link',
  'store',
  'gear',
  'library',
  'chevron-right',
  'pencil',
  'chevron-down',
  'x',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

const modules = import.meta.glob<SvgComponent>('./svg/*.svg', {
  query: '?react',
  import: 'default',
  eager: true,
});

/** Tên tệp SVG có trong thư mục (dùng cho kiểm thử "đủ 26 tên"). */
export const AVAILABLE_ICON_FILES: readonly string[] = Object.keys(modules).map((p) =>
  p.replace('./svg/', '').replace('.svg', ''),
);

export interface IconProps {
  name: IconName;
  /** Có `title` → biểu tượng mang nghĩa (đọc được); không có → trang trí (`aria-hidden`). */
  title?: string;
  className?: string;
}

export function Icon({ name, title, className }: IconProps) {
  const Svg = modules[`./svg/${name}.svg`];
  if (Svg === undefined) return null;
  const a11y =
    title === undefined
      ? ({ 'aria-hidden': true, focusable: false } as const)
      : ({ role: 'img', 'aria-label': title } as const);
  return <Svg className={cn('size-6 shrink-0', className)} {...a11y} />;
}
