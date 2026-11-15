import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { CalendarItem } from './CalendarItem';
import { DayCell } from './DayCell';
import { calendarItemCatalog, dayCellCatalog } from './calendar.catalog';

describe('calendar', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [dayCellCatalog, calendarItemCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
  it('DayCell: chọn, hôm nay, số bài', () => {
    const onSelect = vi.fn();
    render(<DayCell weekday="T2" day={16} today selected count={3} onSelect={onSelect} />);
    const cell = screen.getByRole('button');
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    expect(cell).toHaveAttribute('aria-current', 'date');
    expect(screen.getByText('3 bài')).toBeInTheDocument();
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenCalled();
  });
  it('CalendarItem: có biểu tượng và chữ trạng thái (ẩn thị giác)', () => {
    const { container } = render(<CalendarItem status="attention" time="09:00" title="Bài A" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Cần bạn xử lý')).toBeInTheDocument();
  });
});
