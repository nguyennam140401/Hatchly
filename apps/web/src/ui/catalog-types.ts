import type { ReactNode } from 'react';

// Hình dạng mô tả mà mỗi `*.catalog.tsx` xuất ra để trang danh mục `/_catalog` liệt kê (FR-033).
export interface CatalogVariant {
  label: string;
  render: () => ReactNode;
}

export interface CatalogEntry {
  name: string;
  description: string;
  a11yNotes: string;
  variants: CatalogVariant[];
}
