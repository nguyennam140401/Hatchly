const nf = new Intl.NumberFormat('vi-VN');

/** Số đếm có dấu phân cách nghìn kiểu Việt Nam. */
export function formatCount(n: number): string {
  return nf.format(n);
}

/** Phần trăm làm tròn, chặn trong 0–100. */
export function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

/** Dung lượng: B → KB → MB → GB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)} ${units[i]}`;
}
