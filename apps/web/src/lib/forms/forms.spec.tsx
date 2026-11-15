/* eslint-disable react-hooks/globals -- kiểm thử lấy API của hook qua biến ngoài component */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeMe } from '../../../test/helpers/render';
import { SessionContext } from '../session/context';
import { clearAllAccountData } from '../session/clear-account-data';
import { draftStore, stripSensitive } from './draft-store';
import { schemaResolver, type FormSchema } from './resolver';
import { useAppForm } from './useAppForm';
import { useWizard, type WizardStep } from './useWizard';

describe('draftStore', () => {
  it('chỉ RAM, khóa theo người dùng; không khôi phục cho người khác', () => {
    draftStore.clearAll();
    draftStore.save('u-1', 'profile', { intro: 'xin chào' });
    expect(draftStore.load('u-1', 'profile')?.value).toEqual({ intro: 'xin chào' });
    expect(draftStore.load('u-2', 'profile')).toBeUndefined();
  });
  it('trường nhạy cảm (theo tên hoặc khai báo) không bao giờ vào bản nháp', () => {
    expect(stripSensitive({ password: 'a', token: 'b', otpCode: 'c', file: 'd', intro: 'ok', custom: 'x' }, ['custom'])).toEqual({
      intro: 'ok',
    });
  });
  it('clearAllAccountData() xóa mọi bản nháp', () => {
    draftStore.save('u-1', 'a', { x: 1 });
    clearAllAccountData();
    expect(draftStore.snapshot()).toHaveLength(0);
  });
});

describe('schemaResolver', () => {
  const schema: FormSchema<{ a: string }> = {
    safeParse: (v) => {
      const a = (v as { a?: string }).a;
      return a === undefined || a === ''
        ? { success: false, error: { issues: [{ path: ['a'], message: 'Thiếu a' }, { path: ['a'], message: 'Lỗi thứ hai' }] } }
        : { success: true, data: { a } };
    },
  };
  it('chỉ giữ lỗi đầu tiên của mỗi ô', async () => {
    const result = await schemaResolver(schema)({ a: '' }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect((result.errors as { a?: { message?: string } }).a?.message).toBe('Thiếu a');
  });
  it('hợp lệ → trả dữ liệu đã kiểm', async () => {
    const result = await schemaResolver(schema)({ a: 'x' }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(result.values).toEqual({ a: 'x' });
  });
});

interface W extends Record<string, unknown> {
  a: string;
  b: string;
}
const stepSchema = (key: keyof W): FormSchema<Partial<W>> => ({
  safeParse: (v) =>
    typeof (v as W)[key] === 'string' && (v as W)[key] !== ''
      ? { success: true, data: v as Partial<W> }
      : { success: false, error: { issues: [{ path: [key], message: `Thiếu ${key}` }] } },
});
const steps: WizardStep<W>[] = [
  { id: 's1', schema: stepSchema('a') },
  { id: 's2', schema: stepSchema('b'), skippable: true },
  { id: 's3', schema: stepSchema('b') },
];
const whole: FormSchema<W> = { safeParse: (v) => ({ success: true, data: v as W }) };

function useBoth() {
  const form = useAppForm<W>({ schema: whole, defaultValues: { a: '', b: '' }, onSubmit: () => Promise.resolve() });
  const wizard = useWizard(form, steps);
  return { form, wizard };
}

function renderWizard() {
  // useWizard cần router dữ liệu: dựng router với phần tử là component gọi hook.
  let api: ReturnType<typeof useBoth> | undefined;
  function Probe() {
    api = useBoth();
    return <p>{api.wizard.stepId}</p>;
  }
  const r2 = createMemoryRouter([{ path: '/', element: <Probe /> }], { initialEntries: ['/'] });
  render(
    <SessionContext.Provider value={{ me: fakeMe('owner'), refresh: () => Promise.resolve() }}>
      <RouterProvider router={r2} />
    </SessionContext.Provider>,
  );
  return { get: () => api, router: r2 };
}

describe('useWizard', () => {
  it('kiểm theo lược đồ của bước hiện tại; hợp lệ mới chuyển bước; bước nằm trong URL', async () => {
    const w = renderWizard();
    expect(w.get()?.wizard.stepId).toBe('s1');
    await act(async () => {
      expect(await w.get()?.wizard.next()).toBe(false); // thiếu `a`
    });
    expect(w.get()?.wizard.stepId).toBe('s1');
    act(() => {
      w.get()?.form.methods.setValue('a', 'đã nhập');
    });
    await act(async () => {
      expect(await w.get()?.wizard.next()).toBe(true);
    });
    await waitFor(() => {
      expect(w.get()?.wizard.stepId).toBe('s2');
    });
    expect(w.router.state.location.search).toBe('?step=s2');
  });

  it('"Bỏ qua" chỉ ở bước cho phép; quay lại bước trước', async () => {
    const w = renderWizard();
    act(() => {
      w.get()?.wizard.goTo('s2');
    });
    await waitFor(() => {
      expect(w.get()?.wizard.skippable).toBe(true);
    });
    act(() => {
      w.get()?.wizard.skip();
    });
    await waitFor(() => {
      expect(w.get()?.wizard.stepId).toBe('s3');
    });
    expect(w.get()?.wizard.skippable).toBe(false);
    act(() => {
      w.get()?.wizard.back();
    });
    await waitFor(() => {
      expect(w.get()?.wizard.stepId).toBe('s2');
    });
  });
});

describe('useAppForm – chỉ xem', () => {
  it('readOnly: submit không gọi onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    let form: ReturnType<typeof useAppForm<W>> | undefined;
    function Probe() {
      form = useAppForm<W>({ schema: whole, defaultValues: { a: '', b: '' }, readOnly: true, onSubmit });
      return <button type="button" onClick={() => void form?.submit()}>go</button>;
    }
    const router = createMemoryRouter([{ path: '/', element: <Probe /> }], { initialEntries: ['/'] });
    render(
      <SessionContext.Provider value={{ me: fakeMe('owner'), refresh: () => Promise.resolve() }}>
        <RouterProvider router={router} />
      </SessionContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
