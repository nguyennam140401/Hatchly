import { fireEvent, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import {
  testForm,
  type,
  type FormContractSpec,
  type HarnessProps,
} from '../ui/form/__tests__/form-contract';
import { LoginForm, type LoginValues } from './auth/LoginPage';
import { RegisterForm, type RegisterValues } from './auth/RegisterPage';
import { InviteForm, type InviteValues } from './members/InviteForm';

// Biểu mẫu THẬT của 004/009 chạy ĐỦ 10 hành vi của hợp đồng biểu mẫu (SC-007, FR-036): đăng nhập, đăng ký, mời thành viên.

// Bộ kiểm thử truyền hàm giả có kiểu rộng (`Record<string, unknown>`); mỗi biểu mẫu thật có kiểu giá trị riêng.
function adapt<V extends Record<string, unknown>>(
  Component: ComponentType<{
    onSubmit: (values: V, ctx: { version: number | undefined }) => Promise<unknown>;
    loadLatest?: () => Promise<{ values: V; version: number }>;
    readOnly?: boolean;
    draftKey?: string;
  }>,
): ComponentType<HarnessProps> {
  return function Adapted(props: HarnessProps) {
    return (
      <Component
        onSubmit={props.onSubmit}
        {...(props.loadLatest !== undefined ? { loadLatest: props.loadLatest as never } : {})}
        {...(props.readOnly !== undefined ? { readOnly: props.readOnly } : {})}
        {...(props.draftKey !== undefined ? { draftKey: props.draftKey } : {})}
      />
    );
  };
}

const password = { label: 'Mật khẩu', value: 'Hoa-sen-no-2026-xyz' };

const login: FormContractSpec = {
  name: 'LoginForm',
  Form: adapt<LoginValues>(LoginForm),
  submitLabel: 'Đăng nhập',
  fillValid: () => {
    type('Email', 'lan@example.vn');
    type('Mật khẩu', 'mat-khau-thu');
  },
  fillInvalid: () => {
    type('Email', '');
    return 'Email';
  },
  invalidMessage: /Vui lòng nhập email/,
  serverField: { path: 'email', message: 'Email này chưa đúng định dạng.', label: 'Email' },
  sensitive: password,
};

const register: FormContractSpec = {
  name: 'RegisterForm',
  Form: adapt<RegisterValues>(RegisterForm),
  submitLabel: 'Tạo tài khoản',
  fillValid: () => {
    type('Tên hiển thị', 'Tiệm hoa Lan');
    type('Email', 'lan@example.vn');
    type('Mật khẩu', 'Hoa-sen-no-2026');
    fireEvent.click(screen.getByRole('checkbox'));
  },
  fillInvalid: () => {
    type('Tên hiển thị', '');
    return 'Tên hiển thị';
  },
  invalidMessage: /Vui lòng nhập tên hiển thị/,
  serverField: { path: 'email', message: 'Email này đã dùng.', label: 'Email' },
  sensitive: password,
};

const invite: FormContractSpec = {
  name: 'InviteForm',
  Form: adapt<InviteValues>(InviteForm),
  submitLabel: 'Mời',
  fillValid: () => {
    type('Email của người được mời', 'tu@example.vn');
  },
  fillInvalid: () => {
    type('Email của người được mời', '');
    return 'Email của người được mời';
  },
  invalidMessage: /Vui lòng nhập email của người bạn muốn mời/,
  serverField: {
    path: 'email',
    message: 'Email này không hợp lệ.',
    label: 'Email của người được mời',
  },
  // Địa chỉ người được mời không vào bản nháp (khai báo `sensitiveFields`).
  sensitive: { label: 'Email của người được mời', value: 'nguoi.la.5566@example.vn' },
};

testForm(login);
testForm(register);
testForm(invite);
