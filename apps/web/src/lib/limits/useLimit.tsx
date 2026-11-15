import type { ReactNode } from 'react';
import { t } from '../i18n/t';
import { useUsage, type UsageSnapshot } from './useUsage';

// Khóa theo giới hạn: ngưỡng 80% (`near`) → cảnh báo; 100% (`reached`) → mọi nút phụ thuộc khóa CÙNG LÚC (cùng một truy vấn).
// Chỉ khóa chức năng bị giới hạn (vd AI): soạn tay, duyệt, đăng, tải media, gán nhãn tay vẫn dùng được (hiến pháp III, FR-032).

export type LimitKind = 'ai' | 'posts' | 'storage';

export interface LimitState {
  locked: boolean;
  /** Đã ≥ 80% nhưng chưa khóa. */
  near: boolean;
  /** 0–100. */
  percent: number;
  reason?: string;
  reopensAt?: Date;
}

const NEAR_PERCENT = 80;

export function limitOf(kind: LimitKind, usage: UsageSnapshot | undefined): LimitState {
  if (usage === undefined) return { locked: false, near: false, percent: 0 };
  if (kind === 'ai') {
    const percent = Math.min(100, Math.max(0, usage.ai.percent));
    const locked = usage.ai.level === 'reached' || usage.ai.percent >= 100;
    return {
      locked,
      near: !locked && (usage.ai.level === 'near' || percent >= NEAR_PERCENT),
      percent,
      ...(locked ? { reason: t('limit.ai.reached') } : {}),
      ...(locked && usage.ai.reopensAt !== undefined ? { reopensAt: new Date(usage.ai.reopensAt) } : {}),
    };
  }
  const [used, limit] =
    kind === 'posts'
      ? [usage.posts.used, usage.posts.limit]
      : [usage.storage.usedBytes, usage.storage.limitBytes];
  const percent = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const locked = limit > 0 && used >= limit;
  return {
    locked,
    near: !locked && percent >= NEAR_PERCENT,
    percent,
    ...(locked ? { reason: t(kind === 'posts' ? 'limit.posts.reached' : 'limit.storage.reached') } : {}),
  };
}

export function useLimit(kind: LimitKind): LimitState {
  return limitOf(kind, useUsage().usage);
}

export interface LimitGateProps {
  kind: LimitKind;
  /** Render-prop: truyền `locked`, `lockedReason`, `reopensAt` thẳng vào `<Button>`. */
  children: (state: LimitState) => ReactNode;
}

/** Nút phụ thuộc hạn mức: một nguồn dữ liệu cho mọi nơi dùng. */
export function LimitGate({ kind, children }: LimitGateProps) {
  return <>{children(useLimit(kind))}</>;
}
