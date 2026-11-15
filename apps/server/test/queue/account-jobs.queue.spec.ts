// 009 – T028, T059, T063: ba loại việc nền của module account.
//  - `account.mail_notice`: tạo trong cùng giao dịch với dữ liệu; dữ liệu việc chỉ có mã tham chiếu; bộ xử
//    lý tra người nhận trong tenant; chạy lại an toàn.
//  - `account.auth_housekeeping`: hết hạn lời mời + kiểm toán, dọn bảng dùng chung; chạy hai lần như một.
//  - `account.detached_users`: báo trước rồi xóa người ở tài khoản chờ (SC-010, FR-028a).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { MemoryMailTransport } from '../../src/core/mail/memory.transport';
import { runDetachedUsers } from '../../src/modules/account/internal/auth/detached-users.handler';
import { runAuthHousekeeping } from '../../src/modules/account/internal/auth/housekeeping.handler';
import { createMailNoticeHandler } from '../../src/modules/account/internal/auth/mail-notice.handler';
import { enqueueMailNotice, mailNotice } from '../../src/modules/account/jobs';
import { registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import {
  markVerified,
  seedDetachedUser,
  seedInvitation,
  seedUser,
  type SeededUser,
} from '../db/helpers/auth-seed';
import { runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const noticeJobs = () => jobs(`data->>'type' = 'account.mail_notice'`);
const CONFIG = { retentionDays: 90, noticeDays: 7 };

async function userRow(userId: string) {
  return asOwner(async (c) => {
    const r = await c.query<{
      account_id: string;
      detached_at: Date | null;
      deletion_notice_sent_at: Date | null;
    }>('SELECT account_id, detached_at, deletion_notice_sent_at FROM account.users WHERE id = $1', [
      userId,
    ]);
    return r.rows[0];
  });
}

describeDb('Việc nền của module account (009)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const mailer = new MemoryMailTransport();
  const logs: Record<string, unknown>[] = [];
  let failNext: 'transient' | null = null;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    unregisterJobHandler(mailNotice.name);
    registerJobHandler(
      mailNotice,
      createMailNoticeHandler({
        mailer: {
          deliver: (message) => {
            if (failNext === 'transient') {
              failNext = null;
              return Promise.resolve({ kind: 'transient', code: 'ETIMEDOUT' });
            }
            return mailer.deliver(message);
          },
        },
        webBaseUrl: 'http://app.test',
        detachedRetentionDays: CONFIG.retentionDays,
        log: { info: (entry) => logs.push(entry) },
      }),
    );
  });
  afterAll(async () => {
    unregisterJobHandler(mailNotice.name);
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    logs.length = 0;
    failNext = null;
  });

  const mailsTo = (email: string) => mailer.messages().filter((m) => m.to === email);

  // ----- account.mail_notice -----

  it('việc tạo trong cùng giao dịch: xác nhận → 1 việc chỉ có mã tham chiếu; hoàn tác → 0 việc', async () => {
    const owner = await seedUser();
    await withAccount(owner.accountId, () =>
      tenantTx((db) =>
        enqueueMailNotice(db, {
          template: 'identity_added',
          userId: owner.userId,
          provider: 'google',
          dedupeKey: 'account.notice:test:1',
        }),
      ),
    );
    const rows = await noticeJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('notify');
    expect(rows[0]!.data.accountId).toBe(owner.accountId);
    expect(rows[0]!.data.payload).toEqual({
      template: 'identity_added',
      userId: owner.userId,
      provider: 'google',
    });
    // Không email, không tên, không liên kết trong dữ liệu việc.
    expect(JSON.stringify(rows[0]!.data)).not.toContain(owner.emailNormalized);

    // Cùng khóa chống trùng → không có việc thứ hai.
    await withAccount(owner.accountId, () =>
      tenantTx((db) =>
        enqueueMailNotice(db, {
          template: 'identity_added',
          userId: owner.userId,
          provider: 'google',
          dedupeKey: 'account.notice:test:1',
        }),
      ),
    );
    expect(await noticeJobs()).toHaveLength(1);

    await expect(
      withAccount(owner.accountId, () =>
        tenantTx(async (db) => {
          await enqueueMailNotice(db, {
            template: 'identity_removed',
            userId: owner.userId,
            dedupeKey: 'account.notice:test:2',
          });
          throw new Error('lỗi giả lập sau enqueue');
        }),
      ),
    ).rejects.toThrow('lỗi giả lập');
    expect(await noticeJobs()).toHaveLength(1);
  });

  it('bộ xử lý tra người nhận trong tenant và gửi thư; nhật ký không có email', async () => {
    const owner = await seedUser();
    await runJobInline(
      mailNotice,
      { template: 'identity_added', userId: owner.userId, provider: 'facebook' },
      { accountId: owner.accountId },
    );
    const sent = mailsTo(owner.emailNormalized);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Bạn vừa thêm một cách đăng nhập');
    expect(sent[0]!.text).toContain('Facebook');
    expect(sent[0]!.text).not.toMatch(/#token=|USD|\$/);
    expect(JSON.stringify(logs)).not.toContain(owner.emailNormalized);
    expect(logs.at(-1)).toMatchObject({ event: 'account.mail_notice.sent', user_id: owner.userId });
  });

  it('người nhận không còn / bị khóa / thuộc tài khoản khác → bỏ qua (thành công), không gửi', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const before = mailer.messages().length;
    // Người của tài khoản khác: RLS không cho thấy → bỏ qua.
    await runJobInline(
      mailNotice,
      { template: 'identity_removed', userId: other.userId },
      { accountId: owner.accountId },
    );
    await asOwner((c) =>
      c.query(`UPDATE account.users SET status = 'disabled' WHERE id = $1`, [owner.userId]),
    );
    await runJobInline(
      mailNotice,
      { template: 'identity_removed', userId: owner.userId },
      { accountId: owner.accountId },
    );
    expect(mailer.messages().length).toBe(before);
    expect(logs.map((l) => l.reason)).toEqual(['recipient_missing', 'recipient_disabled']);
  });

  it('lỗi tạm thời của bộ gửi thư → yêu cầu thử lại; lần sau gửi được', async () => {
    const owner = await seedUser();
    failNext = 'transient';
    const payload = { template: 'identity_removed' as const, userId: owner.userId };
    const first = await runJobInline(mailNotice, payload, { accountId: owner.accountId });
    expect(first).toMatchObject({ kind: 'retry_after' });
    expect(mailsTo(owner.emailNormalized)).toHaveLength(0);
    const second = await runJobInline(mailNotice, payload, {
      accountId: owner.accountId,
      attempt: 2,
    });
    expect(second).toBeUndefined();
    expect(mailsTo(owner.emailNormalized)).toHaveLength(1);
  });

  // ----- account.auth_housekeeping -----

  it('housekeeping: hết hạn lời mời + kiểm toán một lần; chạy lại không đổi gì; không đụng lời mời còn hạn', async () => {
    const owner = await seedUser();
    const expired = await seedInvitation(owner, { seat: 1, expires: '-1 minute' });
    const alive = await seedInvitation(owner, { seat: 2, expires: '3 days' });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO account.oauth_flows (id, flow_token_hash, state_hash, provider, purpose, stage, expires_at, closed_at)
         VALUES (gen_random_uuid(), sha256(random()::text::bytea), ''::bytea, 'google', 'login', 'failed',
                 now() - interval '26 hours', now() - interval '25 hours'),
                (gen_random_uuid(), sha256(random()::text::bytea), ''::bytea, 'google', 'login', 'started',
                 now() + interval '5 minutes', NULL)`,
      );
      await c.query(
        `INSERT INTO account.meta_deletion_requests (id, confirmation_code, kind, subject_hmac, status, received_at)
         VALUES (gen_random_uuid(), 'cu-' || gen_random_uuid(), 'deauthorize', sha256(random()::text::bytea), 'no_data', now() - interval '13 months'),
                (gen_random_uuid(), 'moi-' || gen_random_uuid(), 'deauthorize', sha256(random()::text::bytea), 'no_data', now())`,
      );
    });
    const snapshot = () =>
      asOwner(async (c) => ({
        invitations: (
          await c.query<{ id: string; status: string }>(
            'SELECT id, status FROM account.invitations WHERE account_id = $1 ORDER BY seat',
            [owner.accountId],
          )
        ).rows,
        audits: (
          await c.query(
            `SELECT 1 FROM infra.audit_log WHERE account_id = $1 AND action = 'account.invitation.expired'`,
            [owner.accountId],
          )
        ).rowCount,
        oldFlows: (
          await c.query(
            `SELECT 1 FROM account.oauth_flows WHERE closed_at < now() - interval '24 hours'`,
          )
        ).rowCount,
        liveFlows: (await c.query(`SELECT 1 FROM account.oauth_flows WHERE stage = 'started'`))
          .rowCount,
        oldMeta: (
          await c.query(
            `SELECT 1 FROM account.meta_deletion_requests WHERE received_at < now() - interval '12 months'`,
          )
        ).rowCount,
      }));

    const first = await runAuthHousekeeping();
    expect(first.expiredInvitations).toBeGreaterThanOrEqual(1);
    const afterFirst = await snapshot();
    expect(afterFirst.invitations).toEqual([
      { id: expired.invitationId, status: 'expired' },
      { id: alive.invitationId, status: 'pending' },
    ]);
    expect(afterFirst.audits).toBe(1);
    expect(afterFirst.oldFlows).toBe(0);
    expect(afterFirst.liveFlows).toBeGreaterThanOrEqual(1);
    expect(afterFirst.oldMeta).toBe(0);

    await runAuthHousekeeping();
    expect(await snapshot()).toEqual(afterFirst);
  });

  // ----- account.detached_users -----

  async function detachedUser(owner: SeededUser, detachedAgo: string, noticeAgo?: string) {
    const user = await seedDetachedUser(owner, {
      detachedAgo,
      ...(noticeAgo === undefined ? {} : { noticeAgo }),
    });
    await markVerified(user.userId);
    return user;
  }

  it('đủ 84 ngày → một việc thư báo trước, đặt mốc; chạy lại → không có việc thứ hai', async () => {
    const owner = await seedUser();
    const due = await detachedUser(owner, '84 days');
    const early = await detachedUser(owner, '80 days');

    await runDetachedUsers(CONFIG);
    const rows = (await noticeJobs()).filter((j) => j.data.payload.userId === due.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.payload).toEqual({
      template: 'detached_deletion_notice',
      userId: due.userId,
    });
    expect(rows[0]!.data.accountId).toBe(due.accountId);
    expect((await userRow(due.userId))?.deletion_notice_sent_at).not.toBeNull();
    expect((await userRow(early.userId))?.deletion_notice_sent_at).toBeNull();

    await runDetachedUsers(CONFIG);
    expect((await noticeJobs()).filter((j) => j.data.payload.userId === due.userId)).toHaveLength(
      1,
    );

    // Thư nêu ngày xóa và cách giữ lại.
    await runJobInline(
      mailNotice,
      { template: 'detached_deletion_notice', userId: due.userId },
      { accountId: due.accountId },
    );
    const mail = mailsTo(due.emailNormalized).at(-1);
    expect(mail?.text).toMatch(/sẽ bị xóa vào ngày \d{2}\/\d{2}\/\d{4}/);
    expect(mail?.text).toContain('tạo tài khoản kinh doanh của riêng bạn');
  });

  it('đủ 91 ngày + thư đã gửi 8 ngày → xóa người dùng và tài khoản chờ; dấu vết ở tài khoản cũ còn nguyên', async () => {
    const owner = await seedUser();
    const gone = await detachedUser(owner, '91 days', '8 days');
    const recentNotice = await detachedUser(owner, '91 days', '3 days');

    const result = await runDetachedUsers(CONFIG);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    const state = await asOwner(async (c) => ({
      user: (await c.query('SELECT 1 FROM account.users WHERE id = $1', [gone.userId])).rowCount,
      shell: (await c.query('SELECT 1 FROM account.accounts WHERE id = $1', [gone.accountId]))
        .rowCount,
      identities: (
        await c.query('SELECT 1 FROM account.login_identities WHERE user_id = $1', [gone.userId])
      ).rowCount,
      former: (
        await c.query('SELECT 1 FROM account.former_members WHERE user_id = $1', [gone.userId])
      ).rowCount,
      removedMembership: (
        await c.query(
          `SELECT 1 FROM account.memberships WHERE account_id = $1 AND user_id = $2 AND status = 'removed'`,
          [owner.accountId, gone.userId],
        )
      ).rowCount,
      audit: (
        await c.query<{ account_id: string | null; metadata: Record<string, unknown> }>(
          `SELECT account_id, metadata FROM infra.audit_log
            WHERE action = 'account.user.purged' AND metadata->>'reason' = $1`,
          [`user:${gone.userId}`],
        )
      ).rows,
    }));
    expect(state).toMatchObject({
      user: 0,
      shell: 0,
      identities: 0,
      former: 1,
      removedMembership: 1,
    });
    expect(state.audit).toHaveLength(1);
    // Kiểm toán không chứa email/tên.
    expect(JSON.stringify(state.audit)).not.toContain(gone.emailNormalized);
    // Đủ 90 ngày nhưng thư mới gửi 3 ngày → KHÔNG xóa.
    expect(await userRow(recentNotice.userId)).toBeDefined();

    // Chạy lại: không còn gì để xóa, không lỗi.
    const again = await runDetachedUsers(CONFIG);
    expect(again.purged).toBe(0);
  });

  it('người đã nhận thư báo trước nhưng vừa nhận tài khoản → không bị xóa', async () => {
    const owner = await seedUser();
    const user = await detachedUser(owner, '91 days', '8 days');
    // Mô phỏng `claim` chen vào giữa lúc việc đã lấy danh sách: tài khoản thành active.
    await asOwner(async (c) => {
      await c.query(`UPDATE account.accounts SET status = 'active' WHERE id = $1`, [
        user.accountId,
      ]);
      await c.query(
        'UPDATE account.users SET deletion_notice_sent_at = NULL, detached_at = NULL WHERE id = $1',
        [user.userId],
      );
    });
    await runDetachedUsers(CONFIG);
    expect(await userRow(user.userId)).toMatchObject({ account_id: user.accountId });
  });

  it('mỗi lần xử lý tối đa `batch` người; lần sau xử lý phần còn lại', async () => {
    const owner = await seedUser();
    const a = await detachedUser(owner, '85 days');
    const second = await seedUser();
    const b = await detachedUser(second, '85 days');
    const pendingCount = async () =>
      (
        await Promise.all(
          [a, b].map(async (u) => (await userRow(u.userId))?.deletion_notice_sent_at),
        )
      ).filter((v) => v === null).length;
    // Có thể còn người đến hạn từ ca khác trong cùng CSDL → chạy tới khi hai người này xong.
    const before = await pendingCount();
    expect(before).toBe(2);
    const one = await runDetachedUsers({ ...CONFIG, batch: 1 });
    expect(one.noticed).toBe(1);
    for (let i = 0; i < 20 && (await pendingCount()) > 0; i++) {
      await runDetachedUsers({ ...CONFIG, batch: 1 });
    }
    expect(await pendingCount()).toBe(0);
  });
});
