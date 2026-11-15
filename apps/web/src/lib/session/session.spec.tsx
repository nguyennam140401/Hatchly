import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeMe, renderWithProviders } from '../../../test/helpers/render';
import { clearAllAccountData, registerAccountDataCleaner } from './clear-account-data';
import { Can, useCan, useRole } from './permissions';
import { createQueryClient } from '../api/query-client';
import { safeStorage } from '../safe-storage';

function Probe() {
  const canEdit = useCan('context.edit');
  const role = useRole();
  return (
    <p>
      {role}:{canEdit ? 'sua-duoc' : 'chi-xem'}
    </p>
  );
}

describe('useCan / useRole', () => {
  it('quyền đọc từ me.permissions (chủ sửa được, cộng tác viên chỉ xem)', () => {
    renderWithProviders(<Probe />, { role: 'owner' });
    expect(screen.getByText('owner:sua-duoc')).toBeInTheDocument();
  });
  it('cộng tác viên không có context.edit', () => {
    renderWithProviders(<Probe />, { role: 'collaborator' });
    expect(screen.getByText('collaborator:chi-xem')).toBeInTheDocument();
  });
  it('quyền là dữ liệu: me.permissions quyết định, không phải tên vai trò', () => {
    renderWithProviders(<Probe />, { me: fakeMe('owner', { permissions: [] }) });
    expect(screen.getByText('owner:chi-xem')).toBeInTheDocument();
  });
});

describe('<Can>', () => {
  it('thiếu quyền + hide → không render', () => {
    renderWithProviders(
      <Can permission="members.manage">
        <button type="button">Mời</button>
      </Can>,
      { role: 'collaborator' },
    );
    expect(screen.queryByText('Mời')).toBeNull();
  });
  it('thiếu quyền + locked → render ở trạng thái khóa kèm lý do', () => {
    renderWithProviders(
      <Can permission="members.manage" fallback="locked" lockedReason="Chỉ chủ tài khoản">
        {(s) => <button type="button" aria-disabled={s.locked}>{s.lockedReason ?? 'mở'}</button>}
      </Can>,
      { role: 'collaborator' },
    );
    expect(screen.getByRole('button', { name: 'Chỉ chủ tài khoản' })).toHaveAttribute('aria-disabled', 'true');
  });
  it('đủ quyền → render bình thường', () => {
    renderWithProviders(
      <Can permission="members.manage">
        <button type="button">Mời</button>
      </Can>,
      { role: 'owner' },
    );
    expect(screen.getByText('Mời')).toBeInTheDocument();
  });
});

describe('clearAllAccountData', () => {
  it('dọn QueryClient, kho đăng ký, safe-storage và sessionStorage', () => {
    const client = createQueryClient();
    client.setQueryData(['posts'], [1]);
    safeStorage.set('ui.posts.view', 'list');
    window.sessionStorage.setItem('x', 'y');
    let cleaned = 0;
    const off = registerAccountDataCleaner(() => (cleaned += 1));
    clearAllAccountData(client);
    off();
    expect(client.getQueryData(['posts'])).toBeUndefined();
    expect(safeStorage.get('ui.posts.view')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(cleaned).toBe(1);
  });
});
