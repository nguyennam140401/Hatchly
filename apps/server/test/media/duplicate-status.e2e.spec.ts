// US7 qua API (014 contracts/media-http-api.md mục 5): sau khi Worker phát hiện trùng, `GET /media/uploads/:id` trả `duplicate` kèm tệp đã có,
// thư viện chỉ còn MỘT ô và dung lượng tính một lần.
import { UploadStatusResponse } from '@app/shared/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE } from '../../src/core/storage';
import { createProcessMediaHandler } from '../../src/modules/media/internal/process.handler';
import { QuotaStore } from '../../src/modules/media/internal/quota.store';
import { processMedia } from '../../src/modules/media/jobs';
import { QueueLifecycle, registerJobHandler } from '../../src/modules/queue';
import {
  queueUnit,
  setQueueUnit,
  unregisterJobHandler,
} from '../../src/modules/queue/internal/handlers';
import { runJobInline } from '../support/queue-test-kit';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import { MEDIA, UPLOADS, jpeg, quotaRow, storageOf, uploadAndComplete } from './helpers';
import type { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';

describeDb('Tệp trùng nội dung qua API (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let accountId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    accountId = owner.me.account.id;
    const storage: MemoryObjectStorage = t.app.get(OBJECT_STORAGE);
    const h = createProcessMediaHandler({
      storage,
      quota: new QuotaStore(5 * 1024 ** 3),
      log: { info: () => undefined, warn: () => undefined },
    });
    unregisterJobHandler(processMedia.name);
    // Ứng dụng kiểm thử là API (cấm đăng ký bộ xử lý): đăng ký tạm như một Worker để chạy việc trong tiến trình.
    const unit = queueUnit();
    setQueueUnit(undefined);
    registerJobHandler(processMedia, h.handler, { onFinalFailure: h.onFinalFailure });
    setQueueUnit(unit);
  });
  afterAll(async () => {
    unregisterJobHandler(processMedia.name);
    await t.close();
  });

  it('cùng nội dung, đổi tên ⇒ ô thứ hai báo "duplicate" + liên kết tệp đã có; thư viện 1 ô; dung lượng 1 lần', async () => {
    const first = await uploadAndComplete(t, owner.agent, jpeg('goc.jpg'));
    const second = await uploadAndComplete(t, owner.agent, jpeg('doi-ten.jpg'));
    await runJobInline(processMedia, { mediaId: first.mediaId }, { accountId });
    await runJobInline(processMedia, { mediaId: second.mediaId }, { accountId });

    const okStatus = UploadStatusResponse.parse(
      (await owner.agent.get(`${UPLOADS}/${first.uploadId}`)).body,
    );
    expect(okStatus).toMatchObject({ state: 'completed', mediaStatus: 'ready', duplicateOf: null });
    const dup = UploadStatusResponse.parse(
      (await owner.agent.get(`${UPLOADS}/${second.uploadId}`)).body,
    );
    expect(dup).toMatchObject({
      state: 'duplicate',
      duplicateOf: { mediaId: first.mediaId, displayName: 'goc.jpg' },
    });

    const items = (await owner.agent.get(MEDIA)).body as { items: { id: string }[] };
    expect(items.items.map((i) => i.id)).toEqual([first.mediaId]);
    expect((await quotaRow(accountId))!.used).toBe(jpeg().bytes.length);
    // gọi `complete` lại cho phiên trùng vẫn idempotent (202), không tạo media/việc mới
    expect((await owner.agent.post(`${UPLOADS}/${second.uploadId}/complete`)).status).toBe(202);
    expect(storageOf(t)).toBeDefined();
  });
});
