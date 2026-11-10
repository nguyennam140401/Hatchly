import { describe, expect, it } from 'vitest';
import { can, currentActor, requireCustomer, requireStaff } from '../../src/core/auth/actor';
import { executionStorage } from '../../src/core/context/execution-storage';
import type { Actor } from '../../src/core/context/actor.types';

// T022 (contracts/authz-api.md mục 3): đọc người gọi từ ngữ cảnh thực thi.

const owner: Actor = {
  kind: 'user',
  userId: 'u',
  accountId: 'a',
  role: 'owner',
  emailVerified: true,
  sessionId: 's',
};
const collaborator: Actor = { ...owner, role: 'collaborator' };
const support: Actor = { kind: 'staff', staffId: 'st', role: 'support', sessionId: 's2' };

function withActor<T>(actor: Actor | undefined, fn: () => T): T {
  return executionStorage.run(
    { traceId: 't', source: 'request', ...(actor !== undefined ? { actor } : {}) },
    fn,
  );
}

describe('actor', () => {
  it('ngoài ngữ cảnh hoặc chưa đăng nhập → null, can() false', () => {
    expect(currentActor()).toBeNull();
    expect(can('post.edit')).toBe(false);
    withActor(undefined, () => {
      expect(currentActor()).toBeNull();
      expect(can('status.view')).toBe(false);
    });
  });

  it('can() theo vai trò', () => {
    withActor(owner, () => {
      expect(can('post.approve')).toBe(true);
      expect(can('support.lookup')).toBe(false);
    });
    withActor(collaborator, () => {
      expect(can('post.edit')).toBe(true);
      expect(can('post.approve')).toBe(false);
    });
    withActor(support, () => {
      expect(can('support.lookup')).toBe(true);
      expect(can('post.edit')).toBe(false);
    });
  });

  it('requireCustomer/requireStaff ném lỗi lập trình khi sai loại', () => {
    withActor(owner, () => {
      expect(requireCustomer().userId).toBe('u');
      expect(() => requireStaff()).toThrow(/không phải nhân viên/);
    });
    withActor(support, () => {
      expect(requireStaff().staffId).toBe('st');
      expect(() => requireCustomer()).toThrow(/không phải khách hàng/);
    });
    expect(() => requireCustomer()).toThrow();
  });
});
