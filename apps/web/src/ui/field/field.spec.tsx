import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { Field } from './Field';
import { fieldCatalog } from './field.catalog';

describe('Field', () => {
  it('mọi trạng thái trong catalog không vi phạm trợ năng', async () => {
    for (const v of fieldCatalog.variants) {
      const { container, unmount } = render(<main>{v.render()}</main>);
      expect(await axe(container), v.label).toHaveNoViolations();
      unmount();
    }
  });

  it('nhãn gắn với ô; trợ giúp liên kết aria-describedby; dấu * ẩn với bộ đọc nhưng có chữ "bắt buộc"', () => {
    render(
      <Field label="Email" help="Dùng để đăng nhập" required>
        {(c) => <input {...c} type="email" />}
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAccessibleDescription('Dùng để đăng nhập');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('(bắt buộc)')).toBeInTheDocument();
  });

  it('lỗi: biểu tượng + chữ + cách sửa; aria-invalid; mô tả đọc được', () => {
    const { container } = render(
      <Field label="Email" error={{ message: 'Email chưa đúng.', fix: 'Kiểm tra dấu @.' }}>
        {(c) => <input {...c} type="email" />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Email chưa đúng. Kiểm tra dấu @.');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('ô cao ≥ 44 px và chữ ≥ 16 px (lớp min-h-touch, text-body)', () => {
    render(<Field label="A">{(c) => <input {...c} />}</Field>);
    const input = screen.getByLabelText('A');
    expect(input.className).toContain('min-h-touch');
    expect(input.className).toContain('text-body');
  });
});
