// Phân trang theo con trỏ: `total` là tùy chọn (máy chủ có thể không đếm).
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export function hasNextPage(page: Pick<CursorPage<unknown>, 'nextCursor'>): boolean {
  return page.nextCursor !== null;
}
