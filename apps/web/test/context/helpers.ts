// Dữ liệu giả cho kiểm thử màn hình hồ sơ kinh doanh (006 nhóm f). Dùng lại fakeApi/renderAt của auth.
import { apiError, me } from '../auth/helpers';

export const OWNER_ID = '0190a000-0000-7000-8000-000000000001';
export const PROFILE_ID = '0190a000-0000-7000-8000-0000000000aa';
export const vid = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export function meWith(role: 'owner' | 'collaborator', permissions?: string[]) {
  return {
    ...me({ role }),
    permissions:
      permissions ?? (role === 'owner' ? ['context.view', 'context.edit'] : ['context.view']),
  };
}

export const fields = (over: Record<string, unknown> = {}) => ({
  industryCode: 'fashion',
  industryOther: null,
  introduction: 'Tiệm áo dài may đo ở Huế.',
  products: null,
  policies: null,
  tone: null,
  keywords: [],
  ...over,
});

export function profileView(version: number, over: Record<string, unknown> = {}) {
  return {
    profileId: PROFILE_ID,
    version,
    // 03:05 UTC = 10:05 giờ Việt Nam.
    savedAt: '2026-11-10T03:05:00.000Z',
    savedBy: { userId: OWNER_ID, displayName: 'Chị Lan', memberStatus: 'active' },
    fields: fields(over),
  };
}

export const emptyList = { items: [], page: 1, pageSize: 20, total: 0 };

export function versionList(versions: number[], total = versions.length, page = 1) {
  return {
    items: versions.map((v) => ({
      versionId: vid(v),
      version: v,
      savedAt: '2026-11-10T03:05:00.000Z',
      savedBy:
        v === 1
          ? { userId: vid(900), displayName: null, memberStatus: 'left' }
          : { userId: OWNER_ID, displayName: 'Chị Lan', memberStatus: 'active' },
    })),
    page,
    pageSize: 20,
    total,
  };
}

export function errorBody(
  code: string,
  message: string,
  actions: { kind: string; label: string; href?: string }[] = [{ kind: 'retry', label: 'Thử lại' }],
  fieldErrors?: { path: string[]; message: string }[],
) {
  const base = apiError(code, { message });
  return {
    error: {
      ...base.error,
      actions,
      ...(fieldErrors !== undefined ? { fieldErrors } : {}),
    },
  };
}
