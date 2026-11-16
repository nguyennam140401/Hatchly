import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { ProgressRow } from './ProgressRow';
import { StepRow } from './StepRow';
import { progressRowCatalog, stepRowCatalog } from './steps.catalog';

describe('steps', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [stepRowCatalog, progressRowCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
  it('StepRow luôn có chữ trạng thái (kể cả khi giảm chuyển động)', () => {
    render(<StepRow state="pending" running title="Chờ" />);
    expect(screen.getByText(/Đang xử lý/)).toBeInTheDocument();
  });
  it('StepRow lỗi hiện lời giải thích + cách khắc phục', () => {
    render(<StepRow state="error" title="Gửi" explanation="Chưa nhận" remedy="Thử lại" />);
    expect(screen.getByText(/Lỗi/)).toBeInTheDocument();
    expect(screen.getByText('Chưa nhận')).toBeInTheDocument();
    expect(screen.getByText('Thử lại')).toBeInTheDocument();
  });
  it('ProgressRow: aria-valuenow và chữ số', () => {
    render(<ProgressRow label="Tạo bài" done={3} total={10} />);
    expect(screen.getByRole('progressbar', { name: 'Tạo bài' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.getByText('3/10 (30%)')).toBeInTheDocument();
  });
});
