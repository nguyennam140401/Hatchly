import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from '@testing-library/react';
import type { ComponentType } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeMe } from '../../../../test/helpers/render';
import { axe } from '../../../../test/helpers/axe';
import { AppError } from '../../../lib/api/errors';
import { draftStore } from '../../../lib/forms/draft-store';
import { SessionContext } from '../../../lib/session/context';

// Bộ kiểm thử HỢP ĐỒNG dùng chung cho MỌI biểu mẫu (SC-007, contracts/forms.md mục 7): 10 hành vi bắt buộc.
// Biểu mẫu nào (mẫu của danh mục, ProfileForm, LoginForm, RegisterForm, mời thành viên…) cũng đăng ký vào đây bằng `testForm()`.

export interface HarnessProps {
  onSubmit: (
    values: Record<string, unknown>,
    ctx: { version: number | undefined },
  ) => Promise<unknown>;
  loadLatest?: () => Promise<{ values: Record<string, unknown>; version: number }>;
  readOnly?: boolean;
  draftKey?: string;
}

export interface FormContractSpec {
  name: string;
  Form: ComponentType<HarnessProps>;
  submitLabel: string;
  /** Điền hợp lệ mọi ô bắt buộc. */
  fillValid: () => void;
  /** Làm một ô sai; trả về nhãn ô đó. */
  fillInvalid: () => string;
  /** Lời nhắn lỗi kiểm tra của ô sai. */
  invalidMessage: string | RegExp;
  /** Lỗi theo ô do máy chủ trả (đường dẫn chấm + nhãn ô tương ứng). */
  serverField: { path: string; message: string; label: string };
  /** Ô nhạy cảm: giá trị KHÔNG được xuất hiện trong bản nháp/bộ lưu. */
  sensitive: { label: string; value: string };
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ô nhập theo nhãn: nhãn có thể kèm dấu * và "(bắt buộc)" nên so khớp phần đầu. */
export const labelInput = (label: string | RegExp): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>(
    typeof label === 'string' ? new RegExp(`^${escapeRe(label)}`) : label,
    { selector: 'input, textarea, select' },
  );

export function type(label: string | RegExp, value: string): void {
  fireEvent.change(labelInput(label), { target: { value } });
}

/** Dựng biểu mẫu trong bối cảnh tối thiểu: router dữ liệu (cho chặn rời trang) + phiên giả. */
export function mountForm(
  Form: ComponentType<HarnessProps>,
  props: HarnessProps,
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(
    [
      { path: '/form', element: <Form {...props} /> },
      { path: '/other', element: <p>Trang khác</p> },
    ],
    { initialEntries: ['/form'] },
  );
  const view = render(
    <SessionContext.Provider value={{ me: fakeMe('owner'), refresh: () => Promise.resolve() }}>
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return Object.assign(view as RenderResult, { router });
}

const submitButton = (spec: FormContractSpec) =>
  screen.getByRole('button', { name: spec.submitLabel });

const serverError = (spec: FormContractSpec) =>
  new AppError({
    kind: 'validation',
    status: 400,
    code: 'VALIDATION_FAILED',
    message: 'Chưa hợp lệ',
    actions: [{ kind: 'fix_input', label: 'Sửa' }],
    fieldErrors: { [spec.serverField.path]: spec.serverField.message },
  });

export function testForm(spec: FormContractSpec): void {
  describe(`hợp đồng biểu mẫu – ${spec.name}`, () => {
    it('(1) lỗi kiểm tra gắn đúng ô: aria-invalid + aria-describedby tới lời nhắn', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      mountForm(spec.Form, { onSubmit });
      const label = spec.fillInvalid();
      fireEvent.click(submitButton(spec));
      await waitFor(() => {
        expect(labelInput(label)).toHaveAttribute('aria-invalid', 'true');
      });
      expect(labelInput(label)).toHaveAccessibleDescription(spec.invalidMessage);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('(2) lỗi máy chủ theo ô: hiện đúng ô, tiêu điểm tới ô lỗi', async () => {
      const onSubmit = vi.fn().mockRejectedValue(serverError(spec));
      mountForm(spec.Form, { onSubmit });
      spec.fillValid();
      fireEvent.click(submitButton(spec));
      await waitFor(() => {
        expect(labelInput(spec.serverField.label)).toHaveAttribute('aria-invalid', 'true');
      });
      expect(labelInput(spec.serverField.label)).toHaveAccessibleDescription(
        new RegExp(escapeRe(spec.serverField.message)),
      );
      expect(labelInput(spec.serverField.label)).toHaveFocus();
    });

    it('(3) lỗi chung có "Thử lại" gửi lại CÙNG dữ liệu; không báo thành công khi chưa 2xx', async () => {
      const failure = new AppError({
        kind: 'server',
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Hệ thống bận',
        actions: [{ kind: 'retry', label: 'Thử lại' }],
        support: { traceId: 'T-9' },
      });
      const onSubmit = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
      mountForm(spec.Form, { onSubmit });
      spec.fillValid();
      fireEvent.click(submitButton(spec));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Hệ thống bận');
      expect(screen.queryByText(/Đã lưu|thành công/i)).toBeNull();
      fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(2);
      });
      expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
    });

    it('(4) bấm nhanh 10 lần = đúng 1 lời gọi', async () => {
      let release: () => void = () => undefined;
      const onSubmit = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mountForm(spec.Form, { onSubmit });
      spec.fillValid();
      const button = submitButton(spec);
      for (let i = 0; i < 10; i += 1) fireEvent.click(button);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      release();
    });

    it('(5) chặn rời trang khi còn thay đổi chưa lưu', async () => {
      const { router } = mountForm(spec.Form, { onSubmit: vi.fn() });
      spec.fillValid();
      await act(async () => {
        await router.navigate('/other');
      });
      expect(
        await screen.findByRole('dialog', { name: 'Bỏ các thay đổi chưa lưu?' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/form');
      fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(router.state.location.pathname).toBe('/form');
    });

    it('(6) xung đột phiên bản: hai lựa chọn, KHÔNG ghi đè, giữ "Bản của bạn"', async () => {
      const conflict = new AppError({
        kind: 'version_conflict',
        status: 409,
        code: 'VERSION_CONFLICT',
        message: 'Đã có người sửa',
        actions: [{ kind: 'retry', label: 'Xem bản mới' }],
      });
      const onSubmit = vi.fn().mockRejectedValue(conflict);
      const loadLatest = vi.fn().mockResolvedValue({ values: {}, version: 8 });
      mountForm(spec.Form, { onSubmit, loadLatest });
      spec.fillValid();
      fireEvent.click(submitButton(spec));
      expect(await screen.findByText('Nội dung đã được người khác thay đổi')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tải bản mới nhất' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Giữ bản của tôi để xem lại' }),
      ).toBeInTheDocument();
      expect(onSubmit).toHaveBeenCalledTimes(1); // không tự gửi lại
      fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới nhất' }));
      await waitFor(() => {
        expect(loadLatest).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByRole('region', { name: 'Bản của bạn' })).toBeInTheDocument();
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('(7) chế độ chỉ xem: ô chỉ đọc, ẩn nút gửi, nêu lý do', () => {
      mountForm(spec.Form, { onSubmit: vi.fn(), readOnly: true });
      expect(screen.queryByRole('button', { name: spec.submitLabel })).toBeNull();
      expect(screen.getByText('Chỉ chủ tài khoản mới sửa được')).toBeInTheDocument();
      expect(
        labelInput(spec.serverField.label).readOnly || labelInput(spec.serverField.label).disabled,
      ).toBe(true);
    });

    it('(8) giá trị nhạy cảm KHÔNG vào bản nháp hay bộ lưu cục bộ', async () => {
      draftStore.clearAll();
      mountForm(spec.Form, { onSubmit: vi.fn(), draftKey: 'contract-test' });
      spec.fillValid();
      type(spec.sensitive.label, spec.sensitive.value);
      await new Promise((r) => setTimeout(r, 400)); // debounce 300 ms
      const drafts = JSON.stringify(draftStore.snapshot());
      expect(drafts.length).toBeGreaterThan(2); // có lưu phần không nhạy cảm
      expect(drafts).not.toContain(spec.sensitive.value);
      expect(
        JSON.stringify([
          Object.entries(window.localStorage),
          Object.entries(window.sessionStorage),
        ]),
      ).not.toContain(spec.sensitive.value);
    });

    it('(9) không vi phạm trợ năng (axe)', async () => {
      const { container } = mountForm(spec.Form, { onSubmit: vi.fn() });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('(10) chỉ thao tác bằng bàn phím: mọi điều khiển tới được, có nút gửi trong <form>', () => {
      const { container } = mountForm(spec.Form, { onSubmit: vi.fn() });
      const controls = container.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href]',
      );
      for (const el of controls) {
        if (el.classList.contains('sr-only')) continue; // ô chọn tệp ẩn: đã có nút kích hoạt bằng bàn phím
        expect(el.tabIndex, el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(0);
      }
      const button = submitButton(spec);
      expect(button).toHaveAttribute('type', 'submit');
      expect(button.closest('form')).not.toBeNull();
    });
  });
}
