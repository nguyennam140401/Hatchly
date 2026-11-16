// Thời điểm lưu UTC (ISO), hiển thị UTC+7 (quy ước dữ liệu của hiến pháp). Dùng Intl, không thêm thư viện ngày.
const TZ = 'Asia/Ho_Chi_Minh';
const OFFSET_MS = 7 * 3_600_000;

function parts(iso: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** `dd/MM/yyyy`. */
export function formatDate(iso: string): string {
  const p = parts(iso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** `HH:mm`. */
export function formatTime(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

/** `HH:mm dd/MM/yyyy`. */
export function formatDateTime(iso: string): string {
  return `${formatTime(iso)} ${formatDate(iso)}`;
}

/** Giá trị cho `<input type="datetime-local">` (giờ UTC+7) từ ISO UTC. */
export function toLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

/** Ngược lại: chuỗi `datetime-local` (giờ UTC+7) → ISO UTC. */
export function fromLocalInput(local: string): string {
  return new Date(new Date(`${local}:00Z`).getTime() - OFFSET_MS).toISOString();
}

/** "5 phút trước", "2 giờ trước", "3 ngày trước"; xa hơn thì hiện ngày. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(Math.abs(diff) / 60_000);
  const suffix = diff >= 0 ? 'trước' : 'nữa';
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút ${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ ${suffix}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày ${suffix}`;
  return formatDate(iso);
}
