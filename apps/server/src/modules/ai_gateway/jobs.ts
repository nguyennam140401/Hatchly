import { z } from 'zod';
import type { Db } from '../../core';
import { defineJobType, defineSchedule, enqueue, registerJobHandler } from '../queue';
import type { BudgetStore, Crossed } from './internal/budget/budget-store';

// Việc nền của Cổng AI (005, research R8): trả / quyết toán giữ chỗ treo > 15 phút.
// - `ai_gateway.release_stale` (tenant): hẹn trong CÙNG giao dịch giữ chỗ, chạy sau 15 phút trong ngữ
//   cảnh tài khoản của việc (RLS – không quét chéo tài khoản). Idempotent: giữ chỗ đã đóng → không làm gì.
// - `ai_gateway.release_stale_system` (system, mỗi phút): giữ chỗ của ngân sách hệ thống (xu hướng).

export const STALE_RESERVATION_MS = 15 * 60_000;

export const releaseStaleJob = defineJobType({
  name: 'ai_gateway.release_stale',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ reservationId: z.uuid() }),
});

export const releaseStaleSystemJob = defineJobType({
  name: 'ai_gateway.release_stale_system',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

let scheduled = false;

/**
 * Khai báo lịch mỗi phút cho ngân sách hệ thống – CHỈ khi bản giả lập dùng kho `sandbox` (Worker); bản thật
 * WBS 3.1 khai báo lịch của mình. Gọi lại nhiều lần an toàn.
 */
export function defineStaleSystemSchedule(): void {
  if (scheduled) return;
  scheduled = true;
  defineSchedule({
    name: 'ai_gateway.release_stale_system',
    cron: '* * * * *',
    tz: 'UTC',
    jobType: releaseStaleSystemJob,
  });
}

/** Hẹn việc trả giữ chỗ treo – gọi trong giao dịch giữ chỗ (`onReserved` của kho sandbox). */
export async function scheduleStaleRelease(
  _tx: Db,
  reservation: { id: string; reservedAt: Date },
): Promise<void> {
  await enqueue(
    releaseStaleJob,
    { reservationId: reservation.id },
    {
      runAfter: new Date(reservation.reservedAt.getTime() + STALE_RESERVATION_MS + 5_000),
      dedupeKey: `ai_release_stale:${reservation.id}`,
    },
  );
}

let handlersRegistered = false;

/**
 * Đăng ký bộ xử lý (CHỈ Worker). Việc tenant chạy trong ngữ cảnh tài khoản của việc: trả / quyết toán mọi
 * giữ chỗ treo của tài khoản (idempotent – chạy lại hai lần cho cùng kết quả). Gọi lại nhiều lần an toàn.
 */
export function registerAiJobHandlers(
  store: BudgetStore,
  onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>,
): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerJobHandler(releaseStaleJob, async () => {
    const cycleStart = await store.currentCycleStart();
    await store.releaseStale(
      STALE_RESERVATION_MS,
      onCrossed === undefined
        ? undefined
        : { onCrossed: (tx, crossed) => onCrossed(tx, crossed, cycleStart) },
    );
  });
  registerJobHandler(releaseStaleSystemJob, async () => {
    await store.releaseStale(STALE_RESERVATION_MS);
  });
}
