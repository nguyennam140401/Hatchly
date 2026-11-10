import type { ReactNode } from 'react';
import { styles } from './ui';

// Bố cục chung của các trang xác thực – một cột, chạy từ 360 px.
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={styles.page}>
      <p style={{ margin: '0 0 8px', color: '#4b5563' }}>Trợ lý đăng bài</p>
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>{title}</h1>
      {children}
    </main>
  );
}
