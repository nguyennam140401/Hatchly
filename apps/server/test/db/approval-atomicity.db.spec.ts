// T018 + T038 + T077 (012) – hoàn tác trọn gói: lỗi SAU khi tạo mục lịch đăng / hủy lịch → không bài `approved`,
// không mục, không việc, không sự kiện, không kiểm toán, không thông báo. Cùng với chuyển trạng thái có điều kiện
// (xung đột phiên bản ≠ sai trạng thái ≠ không có bài) và các ràng buộc CHECK của CSDL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executionStorage } from '../../src/core/context/execution-storage';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { ApprovalService } from '../../src/modules/approval/internal/approval.service';
import { ContentService } from '../../src/modules/content/internal/content.service';
import { transitionPost } from '../../src/modules/content/internal/posts.repository';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
import type {
  ChannelConnection,
  PlatformGatewayPublicApi,
} from '../../src/modules/platform_gateway';
import { PublishingService } from '../../src/modules/publishing/internal/publishing.service';
import type { PublishingPublicApi } from '../../src/modules/publishing';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const config = {
  POST_MIN_LEAD_MINUTES: 5,
  POST_SUGGEST_HOURS: '09:00,12:00,19:00',
  POST_BULK_APPROVE_LIMIT: 100,
  POST_BULK_SUBMIT_LIMIT: 50,
};

const conn = (id: string): ChannelConnection => ({
  connectionId: id,
  channelType: 'facebook_page',
  displayName: 'Trang thử',
  externalId: id,
  status: 'active',
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  connectedAt: new Date(),
});

describeDb('Hoàn tác trọn gói và chuyển trạng thái có điều kiện (012)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let owner: string;
  let collaborator: string;
  const channel = uuidV7();
  const channel2 = uuidV7();

  const gateway = {
    listConnections: () => Promise.resolve([conn(channel), conn(channel2)]),
    getConnection: (id: string) =>
      Promise.resolve([channel, channel2].includes(id) ? conn(id) : null),
    checkAccount: () => Promise.resolve({ kind: 'eligible', quotaRemaining: null }),
    mediaRules: () => Promise.reject(new Error('không dùng')),
  } as unknown as PlatformGatewayPublicApi;
  const content = new ContentService(gateway, undefined, config);
  const realPublishing = new PublishingService(content, gateway);

  /** Chạy `fn` như một khách hàng của tài khoản (vai trò theo quyền). */
  const as = <T>(
    userId: string,
    role: 'owner' | 'collaborator',
    fn: () => Promise<T>,
  ): Promise<T> =>
    withAccount(account, () => {
      const ctx = executionStorage.getStore();
      if (ctx === undefined) throw new Error('thiếu ngữ cảnh');
      ctx.actor = {
        kind: 'user',
        userId,
        accountId: account,
        role,
        emailVerified: true,
        sessionId: uuidV7(),
        detached: false,
      };
      return fn();
    });

  const approval = (publishing: PublishingPublicApi = realPublishing) =>
    new ApprovalService(
      content,
      publishing,
      new QueueEmitter(),
      { describeMembers: () => Promise.resolve([]) },
      config,
      null,
    );

  const draft = (text = 'Nội dung nháp') =>
    as(owner, 'owner', () =>
      tenantTx(async (db) => {
        const r = await content.createDraft(db, {
          actorUserId: owner,
          fields: {
            internalName: null,
            sharedText: text,
            scheduledAt: null,
            variants: [
              { connectionId: channel, customized: false, text: '', hashtags: [], media: [] },
              { connectionId: channel2, customized: false, text: '', hashtags: [], media: [] },
            ],
          },
        });
        if (r.kind !== 'ok') throw new Error(`createDraft ${r.kind}`);
        return r.post;
      }),
    );

  const counts = (postId: string) =>
    asOwner(async (c) => {
      const q = async (sql: string, p: unknown[] = [postId]) =>
        Number((await c.query<{ n: string }>(sql, p)).rows[0]?.n);
      return {
        attempts: await q(
          'SELECT count(*)::text AS n FROM publishing.publish_attempts WHERE post_id = $1',
        ),
        events: await q(
          "SELECT count(*)::text AS n FROM content.post_events WHERE post_id = $1 AND type <> 'created'",
        ),
        audit: await q(
          "SELECT count(*)::text AS n FROM infra.audit_log WHERE metadata->>'postId' = $1",
        ),
        notify: await q(
          "SELECT count(*)::text AS n FROM pgboss.job_common WHERE name = 'notify' AND data::text LIKE '%' || $1 || '%'",
        ),
        status: (
          await c.query<{ status: string }>('SELECT status FROM content.posts WHERE id = $1', [
            postId,
          ])
        ).rows[0]?.status,
      };
    });

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    account = await createAccount();
    owner = uuidV7();
    collaborator = uuidV7();
  });

  it('duyệt: lỗi giả lập SAU publishing.schedule → bài vẫn Nháp, không mục, không sự kiện, không kiểm toán', async () => {
    const post = await draft();
    const faulty: PublishingPublicApi = {
      schedule: async (tx, input) => {
        await realPublishing.schedule(tx, input);
        throw new Error('lỗi giả lập sau schedule');
      },
      cancelByPost: realPublishing.cancelByPost.bind(realPublishing),
      reschedule: realPublishing.reschedule.bind(realPublishing),
      statusesByPosts: realPublishing.statusesByPosts.bind(realPublishing),
      precheckChannels: realPublishing.precheckChannels.bind(realPublishing),
    };
    await expect(
      as(owner, 'owner', () =>
        approval(faulty).approve(post.id, post.version, new Date(Date.now() + 3 * 3_600_000)),
      ),
    ).rejects.toThrow('lỗi giả lập');
    const c = await counts(post.id);
    expect(c).toMatchObject({ attempts: 0, events: 0, audit: 0, notify: 0, status: 'draft' });
    // Thành công khi không có lỗi: cùng dữ liệu → đủ mục + sự kiện + kiểm toán trong MỘT giao dịch.
    const ok = await as(owner, 'owner', () =>
      approval().approve(post.id, post.version, new Date(Date.now() + 3 * 3_600_000)),
    );
    expect(ok.status).toBe('approved');
    const after = await counts(post.id);
    expect(after).toMatchObject({ attempts: 2, events: 1, audit: 1, status: 'approved' });
  });

  it('sửa bài đã duyệt: lỗi SAU khi hủy lịch → hoàn tác trọn gói (bài vẫn approved, mục còn, nội dung cũ, không thông báo)', async () => {
    const post = await draft('Nội dung gốc');
    const approved = await as(owner, 'owner', () =>
      approval().approve(post.id, post.version, new Date(Date.now() + 3 * 3_600_000)),
    );
    const before = await counts(post.id);
    const faulty: PublishingPublicApi = {
      schedule: realPublishing.schedule.bind(realPublishing),
      cancelByPost: async (tx, id) => {
        await realPublishing.cancelByPost(tx, id);
        throw new Error('lỗi giả lập sau cancelByPost');
      },
      reschedule: realPublishing.reschedule.bind(realPublishing),
      statusesByPosts: realPublishing.statusesByPosts.bind(realPublishing),
      precheckChannels: realPublishing.precheckChannels.bind(realPublishing),
    };
    await expect(
      as(collaborator, 'collaborator', () =>
        approval(faulty).savePost(post.id, {
          expectedVersion: approved.version,
          fields: {
            internalName: null,
            sharedText: 'Nội dung đã sửa',
            variants: approved.variants.map((v) => ({
              connectionId: v.connectionId,
              customized: false,
              text: '',
              hashtags: [],
              media: [],
            })),
          },
        }),
      ),
    ).rejects.toThrow('lỗi giả lập');
    const after = await counts(post.id);
    expect(after).toEqual(before);
    const text = await asOwner(
      async (c) =>
        (
          await c.query<{ shared_text: string }>(
            'SELECT shared_text FROM content.posts WHERE id = $1',
            [post.id],
          )
        ).rows[0]?.shared_text,
    );
    expect(text).toBe('Nội dung gốc');
    expect(after.status).toBe('approved');
  });

  describe('chuyển trạng thái có điều kiện', () => {
    const move = (
      id: string,
      expectedVersion: number,
      from: ('draft' | 'pending_review' | 'approved')[],
    ) =>
      withAccount(account, () =>
        tenantTx((db) =>
          transitionPost(db, {
            postId: id,
            expectedVersion,
            from,
            to: 'pending_review',
            set: { submittedBy: owner, submittedAt: new Date(), submissionId: uuidV7() },
            event: { type: 'submitted', actorUserId: owner, data: {} },
          }),
        ),
      );

    it('đúng phiên bản + đúng trạng thái → ok, version + 1, sự kiện ghi cùng giao dịch', async () => {
      const post = await draft();
      const r = await move(post.id, post.version, ['draft']);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.post.status).toBe('pending_review');
        expect(r.post.version).toBe(post.version + 1);
      }
      expect((await counts(post.id)).events).toBe(1);
    });

    it('lệch phiên bản → conflict kèm bài hiện tại; không có bài → not_found; sai trạng thái → wrong_state', async () => {
      const post = await draft();
      const stale = await move(post.id, post.version + 7, ['draft']);
      expect(stale.kind).toBe('conflict');
      expect(await move(uuidV7(), 1, ['draft'])).toEqual({ kind: 'not_found' });
      const wrong = await move(post.id, post.version, ['approved']);
      expect(wrong.kind).toBe('wrong_state');
      expect((await counts(post.id)).events).toBe(0);
    });

    it('lặp lại cùng chuyển trạng thái: lần hai KHÔNG tạo sự kiện thứ hai (idempotent)', async () => {
      const post = await draft();
      await move(post.id, post.version, ['draft']);
      const again = await move(post.id, post.version, ['draft']);
      expect(again.kind).toBe('conflict');
      expect((await counts(post.id)).events).toBe(1);
    });
  });

  describe('ràng buộc CHECK của CSDL (lớp chặn thứ hai)', () => {
    const tryUpdate = (id: string, setClause: string) =>
      asOwner((c) => c.query(`UPDATE content.posts SET ${setClause} WHERE id = $1`, [id]));

    it("'approved' bắt buộc có giờ đăng, người duyệt, thời điểm duyệt", async () => {
      const post = await draft();
      await expect(tryUpdate(post.id, "status = 'approved'")).rejects.toMatchObject({
        code: '23514',
      });
    });

    it("'pending_review' bắt buộc có người gửi duyệt", async () => {
      const post = await draft();
      await expect(tryUpdate(post.id, "status = 'pending_review'")).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('ghi chú trả lại rỗng hoặc quá 500 ký tự bị từ chối; trạng thái lạ bị từ chối', async () => {
      const post = await draft();
      await expect(tryUpdate(post.id, "returned_note = '   '")).rejects.toMatchObject({
        code: '23514',
      });
      await expect(tryUpdate(post.id, `returned_note = '${'a'.repeat(501)}'`)).rejects.toThrow();
      await expect(tryUpdate(post.id, "status = 'lạ'")).rejects.toMatchObject({ code: '23514' });
    });

    it('nội dung chung > 63.206 ký tự bị từ chối; hashtag có khoảng trắng bị từ chối', async () => {
      const post = await draft();
      await expect(tryUpdate(post.id, `shared_text = repeat('a', 63207)`)).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        asOwner((c) =>
          c.query(
            "UPDATE content.channel_variants SET hashtags = ARRAY['có khoảng trắng'] WHERE post_id = $1",
            [post.id],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
