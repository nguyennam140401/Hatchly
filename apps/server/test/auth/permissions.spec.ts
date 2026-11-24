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
    'context.view',
    'context.edit',
    'channel.manage',
    'channel.view',
    'post.edit',
    'media.upload',
    'media.view',
    'media.delete',
    'post.approve',
    'post.reschedule',
    'post.republish',
    'status.view',
    'members.manage',
    'account.delete',
  ],
  collaborator: [
    'context.view',
    'channel.view',
    'post.edit',
    'media.upload',
    'media.view',
    'media.delete',
    'post.reschedule',
    'post.republish',
    'status.view',
  ],
  // 015: support xem sổ chi phí AI (chỉ nội bộ); admin thêm sửa bảng giá/định tuyến.
  support: ['support.lookup', 'ai.cost.view'],
  admin: [
    'feature.manage',
    'support.lookup',
    'plan.manage',
    'staff.manage',
    'ai.pricing.manage',
    'ai.cost.view',
  ],
} as const;

describe('Danh mục quyền', () => {
  it('có đúng 20 quyền (006: context.view + context.edit; 010: + channel.view, feature.manage; 014: + media.view, media.delete; 015: + ai.pricing.manage, ai.cost.view)', () => {
    expect(PERMISSION_LIST).toHaveLength(20);
    expect(PERMISSION_LIST as string[]).not.toContain('context.manage');
  });

  // T003a (015, FR-011, FR-012): quyền AI nội bộ – khách không bao giờ có.
  it('ai.pricing.manage chỉ admin; ai.cost.view chỉ support và admin; khách đều bị chặn', () => {
    expect(roleHasPermission('admin', 'ai.pricing.manage')).toBe(true);
    expect(roleHasPermission('support', 'ai.pricing.manage')).toBe(false);
    expect(roleHasPermission('owner', 'ai.pricing.manage')).toBe(false);
    expect(roleHasPermission('collaborator', 'ai.pricing.manage')).toBe(false);

    expect(roleHasPermission('support', 'ai.cost.view')).toBe(true);
    expect(roleHasPermission('admin', 'ai.cost.view')).toBe(true);
    expect(roleHasPermission('owner', 'ai.cost.view')).toBe(false);
    expect(roleHasPermission('collaborator', 'ai.cost.view')).toBe(false);
  });

  it('lời giải thích khi bị từ chối quyền AI bằng tiếng Việt và không lộ số tiền', () => {
    for (const p of ['ai.pricing.manage', 'ai.cost.view'] as const) {
      const message = PERMISSION_DENIED_MESSAGES[p];
      expect(message.length, p).toBeGreaterThan(10);
      expect(message, p).not.toMatch(/USD|\$/);
    }
  });

  it('hồ sơ kinh doanh: chủ xem + sửa, cộng tác viên chỉ xem, nội bộ không có gì (FR-008, FR-012)', () => {
    expect(roleHasPermission('owner', 'context.view')).toBe(true);
    expect(roleHasPermission('owner', 'context.edit')).toBe(true);
    expect(roleHasPermission('collaborator', 'context.view')).toBe(true);
    expect(roleHasPermission('collaborator', 'context.edit')).toBe(false);
    for (const role of ['support', 'admin'] as const) {
      expect(roleHasPermission(role, 'context.view')).toBe(false);
      expect(roleHasPermission(role, 'context.edit')).toBe(false);
    }
    expect(PERMISSION_DENIED_MESSAGES['context.view']).toBe(
      'Bạn không có quyền xem hồ sơ kinh doanh.',
    );
    expect(PERMISSION_DENIED_MESSAGES['context.edit']).toBe(
      'Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh.',
    );
  });

  it.each(Object.entries(EXPECTED))(
    'vai trò %s có đúng các quyền của bảng FR-012',
    (role, perms) => {
      // So sánh không phụ thuộc thứ tự khai báo.
      expect([...permissionsOf(role as keyof typeof EXPECTED)].sort()).toEqual([...perms].sort());
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
