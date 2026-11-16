import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  mountForm,
  testForm,
  type FormContractSpec,
  type HarnessProps,
  type,
} from '../../../ui/form/__tests__/form-contract';
import { KeywordsForm } from './KeywordsForm';
import { SingleFieldForm } from './SingleFieldForm';
import { UploadForm } from './UploadForm';

// Ba biểu mẫu mẫu của danh mục (ô đơn, danh sách thẻ từ khóa, tải tệp) chạy ĐỦ 10 hành vi của hợp đồng (T053).

const sensitive = { label: 'Mã bí mật', value: 'MA-RAT-BI-MAT-998877' };

const single: FormContractSpec = {
  name: 'SingleFieldForm',
  Form: SingleFieldForm,
  submitLabel: 'Lưu cửa hàng',
  fillValid: () => {
    type('Tên cửa hàng', 'Tiệm Hoa Nhỏ');
  },
  fillInvalid: () => {
    type('Tên cửa hàng', 'A');
    return 'Tên cửa hàng';
  },
  invalidMessage: /Tên cửa hàng quá ngắn/,
  serverField: {
    path: 'shopName',
    message: 'Tên này đã có người dùng. Hãy chọn tên khác.',
    label: 'Tên cửa hàng',
  },
  sensitive,
};

function addKeyword(value: string) {
  const input = screen.getByLabelText('Từ khóa', { selector: 'input' });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const keywords: FormContractSpec = {
  name: 'KeywordsForm',
  Form: KeywordsForm,
  submitLabel: 'Lưu từ khóa',
  fillValid: () => {
    addKeyword('hoa tươi');
  },
  // Không thêm từ khóa nào → lỗi "ít nhất một".
  fillInvalid: () => 'Từ khóa',
  invalidMessage: /ít nhất một từ khóa/,
  serverField: { path: 'keywords', message: 'Từ khóa này bị cấm.', label: 'Từ khóa' },
  sensitive,
};

const upload: FormContractSpec = {
  name: 'UploadForm',
  Form: UploadForm,
  submitLabel: 'Lưu bộ ảnh',
  fillValid: () => {
    type('Tên bộ ảnh', 'Bộ sưu tập thu');
  },
  fillInvalid: () => {
    type('Tên bộ ảnh', 'B');
    return 'Tên bộ ảnh';
  },
  invalidMessage: /Tên bộ ảnh quá ngắn/,
  serverField: { path: 'albumName', message: 'Tên bộ ảnh đã tồn tại.', label: 'Tên bộ ảnh' },
  sensitive,
};

testForm(single);
testForm(keywords);
testForm(upload);

describe('UploadForm – tải tệp', () => {
  const props: HarnessProps = { onSubmit: () => Promise.resolve() };
  const mount = () => mountForm(UploadForm, props);

  it('tệp sai loại báo lỗi theo từng tệp; tệp đúng vẫn tải xong', async () => {
    mount();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const ok = new File([new Uint8Array(100)], 'anh.jpg', { type: 'image/jpeg' });
    const bad = new File([new Uint8Array(100)], 'tai-lieu.exe', {
      type: 'application/x-msdownload',
    });
    fireEvent.change(input!, { target: { files: [ok, bad] } });
    await waitFor(() => {
      expect(screen.getByText('Đã xong')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('không đúng loại');
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('video > 500 MB bị từ chối trước khi tải', async () => {
    mount();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const video = new File([new Uint8Array(10)], 'phim.mp4', { type: 'video/mp4' });
    Object.defineProperty(video, 'size', { value: 501 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [video] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('500 MB');
    expect(screen.queryByRole('button', { name: 'Thử lại tệp' })).toBeNull();
  });

  it('chọn tệp bằng nút bàn phím (nút "Chọn tệp" tới được)', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Chọn tệp' })).toBeInTheDocument();
  });
});

describe('SingleFieldForm – bộ đếm ký tự', () => {
  it('aria-live="polite" khi đạt ≥ 90% giới hạn (hành vi của 006)', () => {
    mountForm(SingleFieldForm, { onSubmit: () => Promise.resolve() });
    const intro = screen.getByLabelText('Giới thiệu');
    const counter = () => screen.getByText(/^\d+\/100$/);
    fireEvent.change(intro, { target: { value: 'x'.repeat(50) } });
    expect(counter()).toHaveAttribute('aria-live', 'off');
    fireEvent.change(intro, { target: { value: 'x'.repeat(90) } });
    expect(counter()).toHaveAttribute('aria-live', 'polite');
  });
});
