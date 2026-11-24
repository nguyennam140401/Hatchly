import {
  NOTIFICATION_RULES,
  NOTIFICATION_TYPES,
  type NotificationEvent,
  type NotificationType,
} from '@app/shared/notifications';
import { describe, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { NotificationEventInvalidError } from '../../../src/modules/notifications';
import { deliverNotification } from '../../../src/modules/notifications/internal/deliver.handler';
import type { NotifyAccount, NotifyHarness } from './harness';

// Bộ kiểm thử hợp đồng Thông báo (005, contracts/notifications.md mục 7). Mọi ca: phát → flush() → khẳng định.

/** Sự kiện mẫu của MỌI loại – thiếu loại là lỗi biên dịch + lỗi lúc chạy (ca đầu). */
let seq = 0;
/** Ngày duy nhất cho mỗi lần gọi (năm 2100 + n) – khóa theo ngày không trùng ngẫu nhiên. */
const uniqueDay = () => `${2100 + ++seq}-01-01`;

function example(
  type: NotificationType,
  acc: NotifyAccount,
  salt = uuidV7(),
  day = uniqueDay(),
): NotificationEvent {
  const author = acc.collaborator.userId;
  const map: { [T in NotificationType]: () => Extract<NotificationEvent, { type: T }> } = {
    post_pending_review: () => ({
      type: 'post_pending_review',
      refs: { submissionId: salt, postIds: [uuidV7(), uuidV7()], authorUserId: author },
    }),
    post_returned: () => ({
      type: 'post_returned',
      refs: { postId: salt, postVersion: 2, authorUserId: author },
      params: { postTitle: 'Khai trương' },
    }),
    approved_post_rescheduled: () => ({
      type: 'approved_post_rescheduled',
      refs: { postId: salt, postVersion: 3, byUserId: author },
    }),
    batch_generation_done: () => ({
      type: 'batch_generation_done',
      refs: { planId: salt, batchId: uuidV7(), requestedByUserId: author },
    }),
    publish_needs_action: () => ({
      type: 'publish_needs_action',
      refs: { attemptId: salt, postId: uuidV7(), authorUserId: author, state: 'needs_check' },
      params: { postTitle: 'Ưu đãi', channelDisplayName: 'Trang Gió' },
    }),
    channel_token_expiring: () => ({
      type: 'channel_token_expiring',
      refs: { connectionId: salt, expiresOn: day },
    }),
    channel_needs_reconnect: () => ({
      type: 'channel_needs_reconnect',
      refs: { connectionId: salt, day, reason: 'token_expired' },
      params: { channelDisplayName: 'Page Cửa hàng', affectedPosts: 3 },
    }),
    ai_usage_80: () => ({
      type: 'ai_usage_80',
      refs: { cycleStart: day },
      params: { percent: 80 },
    }),
    ai_usage_100: () => ({
      type: 'ai_usage_100',
      refs: { cycleStart: day },
      params: { percent: 100 },
    }),
    plan_expiring: () => ({
      type: 'plan_expiring',
      refs: { subscriptionId: salt, expiresOn: day },
    }),
    data_deletion_scheduled: () => ({ type: 'data_deletion_scheduled', refs: { deleteOn: day } }),
  };
  return map[type]();
}

/** Bảng khóa (data-model.md mục 3): người nhận × kênh × gộp email. Đổi bảng = đổi kiểm thử. */
const EXPECTED: Record<
  NotificationType,
  { recipients: ('owner' | 'author')[]; channels: string[]; emailBatch: string | null }
> = {
  post_pending_review: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
  },
  post_returned: { recipients: ['author'], channels: ['in_app'], emailBatch: null },
  approved_post_rescheduled: { recipients: ['owner'], channels: ['in_app'], emailBatch: null },
  batch_generation_done: { recipients: ['author'], channels: ['in_app'], emailBatch: null },
  publish_needs_action: {
    recipients: ['owner', 'author'],
    channels: ['in_app', 'email'],
    emailBatch: 'batch_10m',
  },
  channel_token_expiring: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
  },
  channel_needs_reconnect: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
  },
  ai_usage_80: { recipients: ['owner'], channels: ['in_app', 'email'], emailBatch: 'immediate' },
  ai_usage_100: { recipients: ['owner'], channels: ['in_app', 'email'], emailBatch: 'immediate' },
  plan_expiring: { recipients: ['owner'], channels: ['in_app', 'email'], emailBatch: 'immediate' },
  data_deletion_scheduled: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
  },
};

export function describeNotificationsContract(harness: () => NotifyHarness): void {
  const h = () => harness();

  async function inNewAccount(fn: (acc: NotifyAccount) => Promise<void>): Promise<void> {
    const acc = await h().newAccount();
    await h().inAccount(acc.accountId, () => fn(acc));
  }
  const emit = (e: NotificationEvent) => h().tx((tx) => h().notifications.emit(tx, e));

  describe('1. danh mục → người nhận, kênh, gộp email', () => {
    it('bảng kiểm phủ đủ NOTIFICATION_TYPES và khớp NOTIFICATION_RULES', () => {
      expect(Object.keys(EXPECTED).sort()).toEqual([...NOTIFICATION_TYPES].sort());
      for (const t of NOTIFICATION_TYPES) {
        expect(NOTIFICATION_RULES[t].channels, t).toEqual(EXPECTED[t].channels);
        expect(NOTIFICATION_RULES[t].emailBatch ?? null, t).toBe(EXPECTED[t].emailBatch);
      }
    });

    for (const type of NOTIFICATION_TYPES) {
      it(type, async () => {
        await inNewAccount(async (acc) => {
          expect(await emit(example(type, acc))).toEqual({ status: 'queued' });
          await h().flush();
          const got = await h().store.delivered({ type });
          const expectIds = EXPECTED[type].recipients.map((r) =>
            r === 'owner' ? acc.owner.userId : acc.collaborator.userId,
          );
          const pairs = got
            .map((n) => `${n.recipientUserId}|${n.channel}|${n.emailBatch ?? '-'}`)
            .sort();
          const want = expectIds
            .flatMap((u) =>
              EXPECTED[type].channels.map(
                (c) => `${u}|${c}|${c === 'email' ? EXPECTED[type].emailBatch : '-'}`,
              ),
            )
            .sort();
          expect(pairs).toEqual(want);
          const emails = got.filter((n) => n.channel === 'email');
          expect(emails.every((n) => n.emailResult === 'sent')).toBe(true);
        });
      });
    }
  });

  describe('2. khóa chống trùng', () => {
    for (const type of NOTIFICATION_TYPES) {
      it(`${type}: cùng tham chiếu → 1; khác → 2`, async () => {
        await inNewAccount(async (acc) => {
          const a = example(type, acc);
          await emit(a);
          await h().flush();
          await emit(structuredClone(a));
          await h().flush();
          expect(await h().store.events()).toHaveLength(1);
          await emit(example(type, acc));
          await h().flush();
          expect(await h().store.events()).toHaveLength(2);
        });
      });
    }

    it('đang chờ cùng khóa → duplicate_pending', async () => {
      await inNewAccount(async (acc) => {
        const e = example('plan_expiring', acc);
        expect(await emit(e)).toEqual({ status: 'queued' });
        expect(await emit(structuredClone(e))).toEqual({ status: 'duplicate_pending' });
        await h().flush();
        expect(await h().store.events()).toHaveLength(1);
      });
    });

    it('hai tài khoản cùng khóa sự kiện (cùng chu kỳ) → mỗi tài khoản đều phát được', async () => {
      const a = await h().newAccount();
      const b = await h().newAccount();
      const e = { type: 'ai_usage_80' as const, refs: { cycleStart: '2031-01-01' } };
      for (const acc of [a, b]) {
        await h().inAccount(acc.accountId, async () => {
          expect(await emit(e)).toEqual({ status: 'queued' });
          await h().flush();
          expect(await h().store.events()).toHaveLength(1);
        });
      }
    });

    it('ai_usage_80: chu kỳ mới phát lại được', async () => {
      await inNewAccount(async () => {
        await emit({ type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' } });
        await emit({ type: 'ai_usage_80', refs: { cycleStart: '2026-12-01' } });
        await h().flush();
        expect((await h().store.events()).map((e) => e.dedupeKey).sort()).toEqual([
          'ai_usage_80:2026-11-01',
          'ai_usage_80:2026-12-01',
        ]);
      });
    });
  });

  describe('3. trường bị cấm', () => {
    it('amountMicroUsd / accessToken / password / content / "$1.20" → từ chối, không tạo việc', async () => {
      await inNewAccount(async (acc) => {
        const base = example('ai_usage_80', acc) as Record<string, unknown>;
        const bad: unknown[] = [
          { ...base, refs: { ...(base.refs as object), amountMicroUsd: 1 } },
          { ...base, params: { accessToken: 'fake_tok_x' } },
          { ...base, password: 'x' },
          { ...base, content: 'POST_CANARY_x' },
          { ...base, params: { postTitle: '$1.20' } },
          { ...base, params: { postTitle: '2 USD' } },
          { type: 'loai_la', refs: {} },
        ];
        for (const e of bad) {
          await expect(emit(e as NotificationEvent)).rejects.toBeInstanceOf(
            NotificationEventInvalidError,
          );
        }
        expect(await h().pendingJobs()).toBe(0);
      });
    });
  });

  describe('4. giao dịch hủy', () => {
    it('giao dịch nghiệp vụ hủy sau emit → 0 việc, 0 thông báo', async (ctx) => {
      if (!h().hasRealTx) {
        ctx.skip(); // chế độ memory không có giao dịch thật – kiểm ở sandbox (pnpm test:db)
        return;
      }
      await inNewAccount(async (acc) => {
        await h()
          .tx(async (tx) => {
            await h().notifications.emit(tx, example('plan_expiring', acc));
            throw new Error('hủy giao dịch nghiệp vụ');
          })
          .catch(() => undefined);
        expect(await h().pendingJobs()).toBe(0);
        await h().flush();
        expect(await h().store.delivered()).toEqual([]);
      });
    });
  });

  describe('5. thành viên đã bị gỡ', () => {
    it('CTV đã gỡ → bỏ qua, chủ vẫn nhận', async () => {
      await inNewAccount(async (acc) => {
        await h().removeMember(acc.collaborator.userId);
        await emit(example('publish_needs_action', acc));
        await h().flush();
        const got = await h().store.delivered();
        expect(new Set(got.map((n) => n.recipientUserId))).toEqual(new Set([acc.owner.userId]));
      });
    });
  });

  describe('6. hành động + nội dung', () => {
    it('mọi thông báo có ≥ 1 hành động; không số tiền, không mã quyền', async () => {
      await inNewAccount(async (acc) => {
        for (const t of NOTIFICATION_TYPES) await emit(example(t, acc));
        await h().flush();
        const got = await h().store.delivered();
        expect(got.length).toBeGreaterThan(0);
        for (const n of got) expect(n.actions.length, n.type).toBeGreaterThanOrEqual(1);
        const all = JSON.stringify(got) + JSON.stringify(h().mail.outbox());
        expect(all).not.toMatch(/\$|USD|micro|fake_tok_|POST_CANARY_/);
      });
    });
  });

  describe('7. chạy lại bộ xử lý', () => {
    it('hai lần cùng việc → cùng kết quả', async () => {
      await inNewAccount(async (acc) => {
        const e = example('channel_token_expiring', acc);
        await deliverNotification(e, { ...h().deps, store: h().store });
        const first = await h().store.delivered();
        const mails = h().mail.outbox().length;
        await deliverNotification(e, { ...h().deps, store: h().store });
        expect(await h().store.delivered()).toEqual(first);
        expect(h().mail.outbox().length).toBe(mails);
      });
    });

    it('email tạm lỗi → thử lại chỉ phần email chưa gửi; lỗi vĩnh viễn → không thử lại', async () => {
      await inNewAccount(async (acc) => {
        h().mail.failFor(acc.owner.email, 'transient', 1);
        await expect(
          deliverNotification(example('plan_expiring', acc), { ...h().deps, store: h().store }),
        ).rejects.toMatchObject({ name: 'EmailTransientError' });
        const again = example('plan_expiring', acc);
        h().mail.failFor(acc.owner.email, 'permanent');
        await deliverNotification(again, { ...h().deps, store: h().store });
        await deliverNotification(again, { ...h().deps, store: h().store });
        const perm = (await h().store.delivered()).filter(
          (n) => n.channel === 'email' && n.emailResult === 'permanent',
        );
        expect(perm).toHaveLength(1);
        h().mail.clear();
      });
    });
  });
}
