import { describe, expect, it } from 'vitest';
import {
  CheckEmailResponse,
  MeResponse,
  PERMISSION_LIST,
  PERMISSIONS,
  changePasswordInput,
  isCustomerPermission,
  loginInput,
  permissionsOf,
  registerInput,
  resendInput,
  verifyEmailInput,
} from '../src/auth/index.js';
import { toFieldErrors } from '../src/core/index.js';

describe('PERMISSIONS (FR-012)', () => {
  it('đúng 13 quyền theo contracts/authz-api.md mục 1', () => {
    expect(PERMISSION_LIST).toEqual([
      'context.manage',
      'channel.manage',
      'post.edit',
      'media.upload',
      'post.approve',
      'post.reschedule',
      'post.republish',
      'status.view',
      'members.manage',
      'account.delete',
      'support.lookup',
      'plan.manage',
      'staff.manage',
    ]);
  });

  it('quyền khách hàng không bao giờ cấp cho nhân viên và ngược lại', () => {
    for (const p of PERMISSION_LIST) {
      const row = PERMISSIONS[p];
      if (isCustomerPermission(p)) {
        expect(row.support || row.admin, p).toBe(false);
      } else {
        expect(row.owner || row.collaborator, p).toBe(false);
      }
    }
  });

  it('permissionsOf: cộng tác viên không có post.approve, members.manage', () => {
    expect(permissionsOf('collaborator')).toEqual([
      'post.edit',
      'media.upload',
      'post.reschedule',
      'post.republish',
      'status.view',
    ]);
    expect(permissionsOf('support')).toEqual(['support.lookup']);
    expect(permissionsOf('admin')).toEqual(['support.lookup', 'plan.manage', 'staff.manage']);
    expect(permissionsOf('owner')).toHaveLength(10);
  });
});

describe('lược đồ đầu vào', () => {
  const valid = {
    displayName: '  Lan  ',
    email: '  Lan@Example.VN ',
    password: 'mot-mat-khau-dai',
    acceptTerms: true,
    termsVersion: '2026-11',
  };

  it('registerInput cắt khoảng trắng tên và email', () => {
    const parsed = registerInput.parse(valid);
    expect(parsed.displayName).toBe('Lan');
    expect(parsed.email).toBe('Lan@Example.VN');
  });

  it('registerInput: thiếu acceptTerms hoặc false → lỗi trên acceptTerms', () => {
    for (const acceptTerms of [undefined, false]) {
      const r = registerInput.safeParse({ ...valid, acceptTerms });
      expect(r.success).toBe(false);
      expect(toFieldErrors(r.error!).map((e) => e.path)).toContainEqual(['acceptTerms']);
    }
  });

  it('mật khẩu 7 ký tự hoặc 129 ký tự bị từ chối, thông điệp tiếng Việt', () => {
    const short = registerInput.safeParse({ ...valid, password: '1234567' });
    expect(toFieldErrors(short.error!)).toContainEqual({
      path: ['password'],
      message: 'Vui lòng nhập ít nhất 8 ký tự.',
    });
    expect(registerInput.safeParse({ ...valid, password: 'a'.repeat(129) }).success).toBe(false);
  });

  it('email tên miền quốc tế được nhận; sai cú pháp bị từ chối', () => {
    expect(loginInput.safeParse({ email: 'lan@cửahàng.vn', password: 'x' }).success).toBe(true);
    const bad = loginInput.safeParse({ email: 'khong-phai-email', password: 'x' });
    expect(toFieldErrors(bad.error!)).toContainEqual({
      path: ['email'],
      message: 'Email không hợp lệ.',
    });
  });

  it('mã một lần chỉ nhận ký tự base64url', () => {
    expect(verifyEmailInput.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
    expect(verifyEmailInput.safeParse({ token: 'a b'.repeat(10) }).success).toBe(false);
  });

  it('resendInput: email tùy chọn; changePasswordInput đủ hai trường', () => {
    expect(resendInput.safeParse({}).success).toBe(true);
    expect(changePasswordInput.safeParse({ newPassword: 'mat-khau-moi-1' }).success).toBe(false);
  });
});

describe('phản hồi', () => {
  it('MeResponse không nhận quyền lạ; CheckEmailResponse cố định', () => {
    const me = {
      user: { id: 'u', displayName: 'Lan', email: 'lan@example.vn', emailVerified: true },
      account: { id: 'a', status: 'active' },
      role: 'owner',
      permissions: ['post.edit'],
    };
    expect(MeResponse.safeParse(me).success).toBe(true);
    expect(MeResponse.safeParse({ ...me, permissions: ['root'] }).success).toBe(false);
    expect(CheckEmailResponse.parse({ status: 'check_email' })).toEqual({ status: 'check_email' });
  });
});
