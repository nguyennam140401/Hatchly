// Nhóm (h) – việc nền "hồ sơ đã thay đổi" (006 contracts/context-public-api.md mục 2, FR-013a, US6).
// Chép mẫu này khi: thao tác ghi tạo việc nền – kiểm (1) đúng 1 việc khi giao dịch xác nhận, 0 việc khi
// hoàn tác (lỗi hợp lệ / xung đột / lỗi giả lập SAU enqueue), (2) payload chỉ mã tham chiếu + dedupeKey,
// (3) bộ xử lý chạy lại an toàn (`expectIdempotent`), (4) hai Worker thật → mỗi việc chạy đúng một lần,
// (5) nhật ký không chứa nội dung nghiệp vụ.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { AppError } from '../../src/core/errors/app-error';
import { describeMembers } from '../../src/modules/account/internal/members/describe-members';
import { profileChanged } from '../../src/modules/context/jobs';
import { createProfileChangedHandler } from '../../src/modules/context/internal/profile-changed.handler';
import { contextPublicApi } from '../../src/modules/context/internal/public-api.impl';
import { ProfileService } from '../../src/modules/context/internal/profile.service';
import { registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import {
  expectIdempotent,
  runJobInline,
  startTestProducer,
  startTestWorkers,
} from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const SECRET_TEXT = 'Nội-dung-bí-mật-không-được-vào-nhật-ký';
const fields = (tone: string | null = null) => ({
  industryCode: 'beauty_services' as const,
  industryOther: null,
  introduction: `Tiệm nail – ${SECRET_TEXT}`,
  products: null,
  policies: null,
  tone,
  keywords: [],
});

const logs: Record<string, unknown>[] = [];
const profileJobs = () => jobs(`data->>'type' = 'context.profile_changed'`);

describeDb('Việc context.profile_changed', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const service = new ProfileService({ describeMembers });

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    unregisterJobHandler(profileChanged.name);
    registerJobHandler(
      profileChanged,
      createProfileChangedHandler({
        context: contextPublicApi,
        log: { info: (entry) => logs.push(entry) },
      }),
    );
  });
  afterAll(async () => {
    unregisterJobHandler(profileChanged.name);
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    logs.length = 0;
  });

  it('lưu v1 → đúng 1 việc { profileId, version: 1 } của tài khoản, dedupeKey profile:<id>:v1', async () => {
    const a = await createAccount();
    const saved = await withAccount(a, () => service.saveProfile(0, fields(), uuidV7()));
    const rows = await profileJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('ai_batch');
    expect(rows[0]!.data.accountId).toBe(a);
    expect(rows[0]!.data.payload).toEqual({ profileId: saved.profile.profileId, version: 1 });
    expect(rows[0]!.singleton_key).toBe(`profile:${saved.profile.profileId}:v1`);
    expect(JSON.stringify(rows[0]!.data)).not.toContain(SECRET_TEXT);
  });

  it('"không có thay đổi" → 0 việc; xung đột → 0 việc', async () => {
    const a = await createAccount();
    await withAccount(a, () => service.saveProfile(0, fields(), uuidV7()));
    await resetQueues();
    const same = await withAccount(a, () => service.saveProfile(1, fields(), uuidV7()));
    expect(same.changed).toBe(false);
    await expect(
      withAccount(a, () => service.saveProfile(5, fields('khác'), uuidV7())),
    ).rejects.toBeInstanceOf(AppError);
    expect(await profileJobs()).toHaveLength(0);
  });

  it('lỗi giả lập SAU enqueue (cùng giao dịch) → hoàn tác cả phiên bản và việc', async () => {
    const a = await createAccount();
    await expect(
      withAccount(a, () =>
        tenantTx(async () => {
          await service.saveProfile(0, fields(), uuidV7());
          throw new Error('lỗi giả lập sau enqueue');
        }),
      ),
    ).rejects.toThrow('lỗi giả lập');
    expect(await profileJobs()).toHaveLength(0);
    const versions = await asOwner((c) =>
      c.query('SELECT 1 FROM context.profile_versions WHERE account_id = $1', [a]),
    );
    expect(versions.rowCount).toBe(0);
  });

  it('bộ xử lý chạy lại an toàn: hai lần cho cùng ảnh chụp CSDL và cùng nhật ký', async () => {
    const a = await createAccount();
    const saved = await withAccount(a, () => service.saveProfile(0, fields(), uuidV7()));
    const payload = { profileId: saved.profile.profileId, version: 1 };
    const snapshot = async () => ({
      db: await asOwner(async (c) => {
        const r = await c.query<{ id: string; version_number: number }>(
          'SELECT id, version_number FROM context.profile_versions WHERE account_id = $1 ORDER BY 2',
          [a],
        );
        return r.rows;
      }),
      // Bỏ mã việc/mã theo dõi (mỗi lần chạy một mã) – phần còn lại phải giống hệt.
      log: logs.map((l) => ({ ...l, job_id: undefined, trace_id: undefined })).at(-1),
    });
    await expectIdempotent(profileChanged, payload, { accountId: a, snapshot });
    expect(logs.map((l) => l.event)).toEqual([
      'context.profile_changed.processed',
      'context.profile_changed.processed',
    ]);
  });

  it('việc v1 chạy khi hiện hành là v2 → superseded, không lỗi', async () => {
    const a = await createAccount();
    const saved = await withAccount(a, () => service.saveProfile(0, fields(), uuidV7()));
    await withAccount(a, () => service.saveProfile(1, fields('mới'), uuidV7()));
    await runJobInline(
      profileChanged,
      { profileId: saved.profile.profileId, version: 1 },
      { accountId: a },
    );
    expect(logs.at(-1)).toMatchObject({
      event: 'context.profile_changed.superseded',
      version: 1,
      current_version: 2,
    });
  });

  it('hai Worker thật → mỗi việc chạy đúng một lần; nhật ký không chứa nội dung hồ sơ', async () => {
    const accounts = await Promise.all([createAccount(), createAccount(), createAccount()]);
    for (const a of accounts)
      await withAccount(a, () => service.saveProfile(0, fields(), uuidV7()));
    expect(await profileJobs()).toHaveLength(3);
    const workers = await startTestWorkers(2, { queues: ['ai_batch'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    const processed = logs.filter((l) => l.event === 'context.profile_changed.processed');
    expect(processed).toHaveLength(3);
    expect(new Set(processed.map((l) => l.job_id)).size).toBe(3);
    expect((await profileJobs()).every((j) => j.state === 'completed')).toBe(true);
    const allLogs = JSON.stringify([...logs, ...workers.logs.entries]);
    expect(allLogs).not.toContain(SECRET_TEXT);
  });
});
