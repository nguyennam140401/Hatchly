import { describe, expect, it } from 'vitest';
import {
  PERMISSION_DENIED_MESSAGES,
  PERMISSION_LIST,
  permissionsOf,
  roleHasPermission,
} from '../../src/core/auth/permissions';

// T018 (FR-012, contracts/authz-api.md mục 1): ma trận vai trò × quyền khớp đúng bảng của đặc tả.

const EXPECTED = {
  owner: [
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
  ],
  collaborator: ['post.edit', 'media.upload', 'post.reschedule', 'post.republish', 'status.view'],
  support: ['support.lookup'],
  admin: ['support.lookup', 'plan.manage', 'staff.manage'],
} as const;

describe('Danh mục quyền', () => {
  it('có đúng 13 quyền', () => {
    expect(PERMISSION_LIST).toHaveLength(13);
  });

  it.each(Object.entries(EXPECTED))(
    'vai trò %s có đúng các quyền của bảng FR-012',
    (role, perms) => {
      expect(permissionsOf(role as keyof typeof EXPECTED)).toEqual(perms);
    },
  );

  it('không quyền khách hàng nào cấp cho nhân viên và ngược lại', () => {
    for (const p of PERMISSION_LIST) {
      const customer = roleHasPermission('owner', p) || roleHasPermission('collaborator', p);
      const staff = roleHasPermission('support', p) || roleHasPermission('admin', p);
      expect(customer && staff, p).toBe(false);
    }
  });

  it('cộng tác viên không duyệt, không kết nối kênh, không quản lý thành viên', () => {
    for (const p of [
      'post.approve',
      'channel.manage',
      'members.manage',
      'account.delete',
    ] as const) {
      expect(roleHasPermission('collaborator', p)).toBe(false);
    }
  });

  it('mọi quyền có lời giải thích tiếng Việt khi bị từ chối', () => {
    for (const p of PERMISSION_LIST) {
      expect(PERMISSION_DENIED_MESSAGES[p].length, p).toBeGreaterThan(10);
    }
    expect(PERMISSION_DENIED_MESSAGES['post.approve']).toBe(
      'Chỉ chủ tài khoản mới duyệt được bài.',
    );
  });
});
