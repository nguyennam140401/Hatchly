import { vi, type ViKey } from './vi';

/** Tra chuỗi tiếng Việt; `{tên}` được thay bằng giá trị trong `params`. */
export function t(key: ViKey, params?: Record<string, string | number>): string {
  const text: string = vi[key];
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
