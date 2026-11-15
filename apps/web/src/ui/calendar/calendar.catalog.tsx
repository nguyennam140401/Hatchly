import type { CatalogEntry } from '../catalog-types';
import { CalendarItem } from './CalendarItem';
import { DayCell } from './DayCell';

export const dayCellCatalog: CatalogEntry = {
  name: 'DayCell',
  description: 'Ô ngày của lịch: chọn/không chọn, hôm nay, số bài.',
  a11yNotes: 'aria-pressed cho ô đang chọn; hôm nay có aria-current="date" + gạch chân.',
  variants: [
    { label: 'thường', render: () => <DayCell weekday="T2" day={16} onSelect={() => undefined} /> },
    { label: 'đang chọn', render: () => <DayCell weekday="T3" day={17} selected count={2} onSelect={() => undefined} /> },
    { label: 'hôm nay', render: () => <DayCell weekday="T4" day={18} today onSelect={() => undefined} /> },
  ],
};

export const calendarItemCatalog: CatalogEntry = {
  name: 'CalendarItem',
  description: 'Mục lịch: chờ duyệt / đã lên lịch / cần xử lý / đã đăng.',
  a11yNotes: 'Trạng thái bằng biểu tượng + chữ ẩn cho bộ đọc màn hình; tiêu đề dài có Tooltip.',
  variants: (['review', 'scheduled', 'attention', 'published'] as const).map((status) => ({
    label: status,
    render: () => <CalendarItem status={status} time="09:00" title="Khuyến mãi cuối tuần cho khách quen" onClick={() => undefined} />,
  })),
};
