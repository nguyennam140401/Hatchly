// Khuôn kiểm thử bộ thực thi 5 bước của Đăng bài (013): thế giới giả có cổng nền tảng kịch bản hóa, nội dung,
// media, tài khoản, thông báo và đồng hồ. Dữ liệu lượt đăng nằm trong CSDL THẬT; chỉ phụ thuộc ngoài là giả.
import { sql } from 'drizzle-orm';
import { tenantTx } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { AccountPublicApi } from '../../../src/modules/account';
import type { ChannelRule, ContentPublicApi, PostRecord } from '../../../src/modules/content';
import type { MediaPublicApi, PublishableMediaResult } from '../../../src/modules/media';
import type { NotificationEvent, NotificationsPublicApi } from '../../../src/modules/notifications';
import type {
  ChannelType,
  ClassifiedError,
  PlatformGatewayPublicApi,
  SubmitResult,
} from '../../../src/modules/platform_gateway';
import type { Db } from '../../../src/core';
import {
  ErrorMappingService,
  type MappingEntry,
} from '../../../src/modules/publishing/internal/error-mapping.service';
import { createExecuteAttemptHandler } from '../../../src/modules/publishing/internal/executor/execute-attempt.handler';
import type { ExecutorDeps } from '../../../src/modules/publishing/internal/executor/types';
import { DEFAULT_PUBLISH_SETTINGS } from '../../../src/modules/publishing/internal/retry-policy';
import { runAttemptJob } from '../../../src/modules/publishing/jobs';
import { registerJobHandler } from '../../../src/modules/queue';
import { unregisterJobHandler } from '../../../src/modules/queue/internal/handlers';
import { asOwner, withAccount } from '../helpers/queue-db';
import { runJobInline } from '../../support/queue-test-kit';

export const err = (
  category: ClassifiedError['category'],
  rawCode: string,
  channelType: ChannelType = 'test_channel',
  retryAfterSec?: number,
): ClassifiedError => ({
  category,
  rawCode,
  channelType,
  messageVi: `Lỗi ${rawCode}`,
  remedies: [{ action: 'retry_later', labelVi: 'Thử lại' }],
  ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
});

export type SubmitStep =
  | 'published'
  | 'processing'
  | 'timeout_after_publish'
  | 'timeout_before_publish'
  | 'throw'
  | { fail: ClassifiedError };

/** Cổng nền tảng kịch bản hóa: ghi lại mọi bài "thật" đã tạo để kiểm "≤ 1 bài". */
export class ScriptedGateway {
  platformPosts: { id: string; hash: string }[] = [];
  submitCalls = 0;
  reconcileCalls = 0;
  checkStatusCalls = 0;
  script: SubmitStep[] = [];
  statusScript: ('processing' | 'done' | 'failed_user')[] = [];
  canReconcile = true;
  reconcileOutcome: 'real' | 'not_found' | 'unsupported' | 'throw' = 'real';
  connectionStatus: 'active' | 'expired' | 'disconnected' = 'active';
  quotaRemaining: number | null = null;
  eligible = true;
  /** Chạy trước `submit` trả về (mô phỏng Worker khác/Worker chết trong lúc gửi). */
  onSubmit: (() => Promise<void>) | undefined;
  lastSubmit: Parameters<PlatformGatewayPublicApi['submit']>[0] | undefined;

  createPost(hash: string): string {
    const id = `post-${this.platformPosts.length + 1}`;
    this.platformPosts.push({ id, hash });
    return id;
  }

  api(): PlatformGatewayPublicApi {
    return makeApi(this);
  }
}

function makeApi(self: ScriptedGateway): PlatformGatewayPublicApi {
  {
    return {
      checkAccount: () =>
        Promise.resolve(
          self.eligible
            ? {
                kind: 'eligible' as const,
                accountType: 'page',
                grantedScopes: [],
                quotaRemaining: self.quotaRemaining,
                tokenExpiresAt: new Date(Date.now() + 86_400_000 * 30),
              }
            : { kind: 'ineligible' as const, error: err('user_action', 'IG:NOT_PROFESSIONAL') },
        ),
      mediaRules: () =>
        Promise.resolve({
          channelType: 'test_channel',
          rules: {
            maxItems: 10,
            image: {
              formats: ['jpeg' as const],
              maxBytes: 8_000_000,
              minAspect: 0.5,
              maxAspect: 2,
            },
            video: null,
            allowMixed: false,
          },
        }),
      async submit(req): Promise<SubmitResult> {
        self.submitCalls++;
        self.lastSubmit = req;
        if (self.onSubmit) await self.onSubmit();
        const step = self.script.shift() ?? 'published';
        if (step === 'throw') throw new Error('boom');
        if (step === 'published') {
          const id = self.createPost(req.contentHash);
          return { kind: 'published', platformPostId: id, permalink: `https://x.test/${id}` };
        }
        if (step === 'processing') {
          self.createPost(req.contentHash);
          return { kind: 'processing', processingId: 'proc-1' };
        }
        if (step === 'timeout_after_publish') {
          self.createPost(req.contentHash);
          return { kind: 'failed', error: err('unknown', 'TIMEOUT_AFTER') };
        }
        if (step === 'timeout_before_publish') {
          return { kind: 'failed', error: err('transient', 'NET_BEFORE_SEND') };
        }
        return { kind: 'failed', error: step.fail };
      },
      checkStatus: () => {
        self.checkStatusCalls++;
        const s = self.statusScript.shift() ?? 'done';
        if (s === 'processing') return Promise.resolve({ kind: 'processing' as const });
        if (s === 'failed_user') {
          return Promise.resolve({
            kind: 'failed' as const,
            error: err('user_action', 'IG:2207026'),
          });
        }
        const id = self.platformPosts[0]?.id ?? 'post-x';
        return Promise.resolve({
          kind: 'done' as const,
          platformPostId: id,
          permalink: `https://x.test/${id}`,
        });
      },
      reconcile: (q) => {
        self.reconcileCalls++;
        if (self.reconcileOutcome === 'throw') return Promise.reject(new Error('down'));
        if (self.reconcileOutcome === 'unsupported') {
          return Promise.resolve({ kind: 'unsupported' as const, reason: 'capability' as const });
        }
        const found =
          self.reconcileOutcome === 'real'
            ? self.platformPosts.find((p) => p.hash === q.contentHash)
            : undefined;
        return Promise.resolve(
          found === undefined
            ? { kind: 'not_found' as const }
            : {
                kind: 'found' as const,
                platformPostId: found.id,
                permalink: `https://x.test/${found.id}`,
              },
        );
      },
      classifyError: (channelType, rawCode) => err('unknown', rawCode, channelType),
      refreshToken: () => Promise.reject(new Error('không dùng')),
      capabilities: () => ({
        reconcile: self.canReconcile,
        asyncProcessing: true,
        tokenRefresh: true,
        reportsQuota: false,
        maxReconcileWindowHours: 24,
      }),
      contentHash: (_c, text) => `ch1:${text}`,
      getConnection: (connectionId) =>
        Promise.resolve({
          connectionId,
          channelType: 'test_channel',
          displayName: 'Trang thử',
          externalId: 'ext-1',
          status: self.connectionStatus,
          tokenExpiresAt: new Date(Date.now() + 86_400_000 * 30),
          connectedAt: new Date(),
        }),
      listConnections: () => Promise.resolve([]),
    };
  }
}

export interface World {
  gateway: ScriptedGateway;
  emitted: NotificationEvent[];
  post: PostRecord;
  media: { result: PublishableMediaResult };
  eligibility: { planActive: boolean; deletionRequested: boolean };
  clock: { offsetMs: number };
  mappings: MappingEntry[];
  deps: ExecutorDeps;
  /** Đăng ký bộ xử lý thật của 013 với thế giới giả này. */
  register(mode?: ExecutorDeps['mode']): void;
  run(attemptId: string, account: string, signal?: AbortSignal): ReturnType<typeof runJobInline>;
}

export function makePost(postId: string, connectionId: string, version = 2): PostRecord {
  return {
    id: postId,
    status: 'approved',
    source: 'manual',
    internalName: 'Bài thử',
    sharedText: 'Nội dung đã duyệt',
    scheduledAt: new Date(),
    createdBy: uuidV7(),
    submittedBy: null,
    submittedAt: null,
    submissionId: null,
    approvedBy: uuidV7(),
    approvedAt: new Date(),
    returnedNote: null,
    returnedBy: null,
    returnedAt: null,
    editedAfterApproval: false,
    version,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [
      {
        id: uuidV7(),
        connectionId,
        channelType: 'test_channel',
        customized: false,
        text: '',
        hashtags: [],
        media: [],
        version: 1,
      },
    ],
  };
}

const rules: ChannelRule[] = [
  {
    channelType: 'test_channel',
    maxTextLength: 63206,
    maxHashtags: null,
    mediaRequired: false,
    maxPostsPer24h: null,
  },
  {
    channelType: 'instagram',
    maxTextLength: 2200,
    maxHashtags: 30,
    mediaRequired: true,
    maxPostsPer24h: 25,
  },
];

export function makeWorld(postId: string, connectionId: string): World {
  const gateway = new ScriptedGateway();
  const emitted: NotificationEvent[] = [];
  const clock = { offsetMs: 0 };
  const eligibility = { planActive: true, deletionRequested: false };
  const media = { result: { kind: 'ok', items: [] } as PublishableMediaResult };
  const mappings: MappingEntry[] = [];
  const post = makePost(postId, connectionId);
  const errorMapping = new ErrorMappingService();
  errorMapping.loader = () => Promise.resolve(mappings);

  const content = {
    getPost: () => Promise.resolve(post),
    channelRules: () => Promise.resolve(rules),
  } as unknown as ContentPublicApi;
  const account = {
    getPublishingEligibility: () => Promise.resolve(eligibility),
    listActiveMembers: () =>
      Promise.resolve([
        { userId: uuidV7(), role: 'owner' as const, email: 'a@b.c', displayName: 'A' },
      ]),
  } as unknown as AccountPublicApi;
  const mediaApi: MediaPublicApi = { getPublishableMedia: () => Promise.resolve(media.result) };
  const notifications: NotificationsPublicApi = {
    emit: (_tx: Db, event: NotificationEvent) => {
      emitted.push(event);
      return Promise.resolve({ status: 'queued' as const });
    },
  };
  const deps: ExecutorDeps = {
    mode: 'run',
    content,
    gateway: gateway.api(),
    media: mediaApi,
    account,
    notifications,
    errorMapping,
    settings: DEFAULT_PUBLISH_SETTINGS,
    now: () => new Date(Date.now() + clock.offsetMs),
  };
  return {
    gateway,
    emitted,
    post,
    media,
    eligibility,
    clock,
    mappings,
    deps,
    register(mode = 'run') {
      unregisterJobHandler(runAttemptJob.name);
      registerJobHandler(runAttemptJob, createExecuteAttemptHandler({ ...deps, mode }));
    },
    run: (attemptId, account, signal) =>
      runJobInline(
        runAttemptJob,
        { attemptId },
        { accountId: account, ...(signal ? { signal } : {}) },
      ),
  };
}

export interface SeedOptions {
  status?: string;
  phase?: string;
  scheduledAt?: Date;
  contentVersion?: number;
  channelType?: string;
  extra?: Record<string, unknown>;
}

/** Mồi một lượt đăng bằng `owner` (không qua RLS). */
export async function seedAttempt(
  account: string,
  postId: string,
  connectionId: string,
  opts: SeedOptions = {},
): Promise<string> {
  const id = uuidV7();
  const extra = opts.extra ?? {};
  const cols = [
    'id',
    'account_id',
    'post_id',
    'channel_connection_id',
    'channel_type',
    'status',
    'scheduled_at',
    'content_version',
    'phase',
    ...Object.keys(extra),
  ];
  const vals = [
    id,
    account,
    postId,
    connectionId,
    opts.channelType ?? 'test_channel',
    opts.status ?? 'scheduled',
    opts.scheduledAt ?? new Date(),
    opts.contentVersion ?? 2,
    opts.phase ?? 'none',
    ...Object.values(extra),
  ];
  await asOwner((c) =>
    c.query(
      `INSERT INTO publishing.publish_attempts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      vals,
    ),
  );
  return id;
}

export interface AttemptSnapshot {
  status: string;
  phase: string;
  run_no: number;
  transient_attempts: number;
  reconcile_retry_used: boolean;
  needs_reason: string | null;
  platform_post_id: string | null;
  permalink: string | null;
  confirmed_by: string | null;
  content_hash: string | null;
  submitted_at: Date | null;
  version: number;
}

export function attemptRow(id: string): Promise<AttemptSnapshot> {
  return asOwner(async (c) => {
    const r = await c.query<AttemptSnapshot>(
      `SELECT status, phase, run_no, transient_attempts, reconcile_retry_used, needs_reason, platform_post_id,
              permalink, confirmed_by, content_hash, submitted_at, version
         FROM publishing.publish_attempts WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error('Không có lượt đăng');
    return row;
  });
}

export function stepRows(id: string) {
  return asOwner(async (c) => {
    const r = await c.query<{
      run_no: number;
      step_no: number;
      step_key: string;
      event: string;
      outcome: string | null;
      error_category: string | null;
      raw_code: string | null;
      note: string | null;
      remedies: unknown;
    }>(
      `SELECT run_no, step_no, step_key, event, outcome, error_category, raw_code, note, remedies
         FROM publishing.publish_steps WHERE attempt_id = $1 ORDER BY occurred_at, step_no, id`,
      [id],
    );
    return r.rows;
  });
}

/** Đẩy `submitted_at` lùi để mô phỏng thời gian trôi (thay vì chờ thật). */
export async function backdateSubmit(id: string, seconds: number): Promise<void> {
  await asOwner((c) =>
    c.query(
      'UPDATE publishing.publish_attempts SET submitted_at = submitted_at - make_interval(secs => $2) WHERE id = $1',
      [id, seconds],
    ),
  );
}

export { sql, tenantTx, withAccount };
