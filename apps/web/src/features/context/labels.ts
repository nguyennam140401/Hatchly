// Nhãn hiển thị của hồ sơ kinh doanh (tách khỏi lớp API: đây là định dạng giao diện, không phải lời gọi).

const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hourCycle: 'h23',
});

/** Thời điểm UTC (ISO) → "HH:mm dd/MM/yyyy" giờ Việt Nam (UTC+7). */
export function formatVnTime(iso: string): string {
  const parts = Object.fromEntries(
    VN_TIME.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.hour ?? ''}:${parts.minute ?? ''} ${parts.day ?? ''}/${parts.month ?? ''}/${parts.year ?? ''}`;
}

/** Tên người lưu hiển thị. */
export function savedByLabel(savedBy: {
  displayName: string | null;
  memberStatus: string;
}): string {
  return savedBy.memberStatus === 'left' || savedBy.displayName === null
    ? 'Thành viên đã rời'
    : savedBy.displayName;
}
