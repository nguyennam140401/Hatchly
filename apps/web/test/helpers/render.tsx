import type { MeResponse } from '@app/shared/auth';
import { PERMISSION_LIST, permissionsOf } from '@app/shared/auth';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { createQueryClient } from '../../src/lib/api/query-client';
import { SessionContext } from '../../src/lib/session/context';

// Dựng thành phần trong bối cảnh đầy đủ: QueryClient mới, phiên giả theo vai trò, MemoryRouter.

export type TestRole = 'owner' | 'collaborator';

export function fakeMe(role: TestRole = 'owner', overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: 'u-1', displayName: 'Chủ Tiệm', email: 'chu@example.test', emailVerified: true },
    account: { id: 'a-1', status: 'active' },
    role,
    permissions: permissionsOf(role).filter((p) => PERMISSION_LIST.includes(p)),
    ...overrides,
  };
}

export interface RenderOptions {
  role?: TestRole;
  me?: MeResponse;
  route?: string;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createQueryClient();
  const me = options.me ?? fakeMe(options.role ?? 'owner');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={{ me, refresh: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>
  );
  const result: RenderResult = render(ui, { wrapper });
  return Object.assign(result, { queryClient });
}
