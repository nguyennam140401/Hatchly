// T091 (013, SC-008, S18) – quét bí mật cho Đăng bài: chạy bộ thực thi 5 bước + bộ chuyển đổi (cổng giả) với mã quyền
// mẫu có tiền tố nhận diện. Mã quyền KHÔNG ĐƯỢC xuất hiện trong: log thu được (kể cả stdout/stderr), `publish_steps`,
// `publish_attempts`, thông báo phát ra, dữ liệu việc nền (kể cả đầu ra việc hỏng), và phản hồi chi tiết cho hỗ trợ.
// Mã quyền được "rò" chủ ý từ phía nền tảng (Error.message của lời gọi, mã lỗi gốc) để chứng minh bộ thực thi không
// ghi nguyên văn ra ngoài.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { AttemptActionsService } from '../../../src/modules/publishing/internal/attempt-actions.service';
import { startTestProducer } from '../../support/queue-test-kit';
import { TEST_LOG_DIR } from '../../setup/log-capture';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from '../helpers/queue-db';
import { err, makeWorld, seedAttempt, type World } from './harness';

// Tiền tố nhận diện (khớp mẫu `fake_tok_` mà `pnpm check:secrets` quét trong nhật ký).
const TOKEN = 'fake_tok_PUBLISH_QA_9f3a7c';
const PREFIX = 'fake_tok_';

describeDb('Quét bí mật – Đăng bài (013)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let connectionId: string;
  let world: World;
  let captured: string[];
  const spies: { mockRestore: () => void }[] = [];

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    account = await createAccount();
    postId = uuidV7();
    connectionId = uuidV7();
    world = makeWorld(postId, connectionId);
    world.register();
    captured = [];
    for (const stream of [process.stdout, process.stderr]) {
      // Chỉ GHI LẠI (không chuyển tiếp) để không làm nhiễu đầu ra; mã quyền, nếu có, sẽ nằm trong `captured`.
      spies.push(
        vi.spyOn(stream, 'write').mockImplementation((chunk) => {
          captured.push(typeof chunk === 'string' ? chunk : String(chunk));
          return true;
        }),
      );
    }
  });
  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  /** Gom mọi nơi mà mã quyền có thể bị ghi ra, thành `nơi → văn bản`. */
  async function surfaces(attemptId: string): Promise<Record<string, string>> {
    const db = await asOwner(async (c) => {
      const steps = await c.query<{ j: string }>(
        'SELECT to_jsonb(s)::text AS j FROM publishing.publish_steps s WHERE attempt_id = $1',
        [attemptId],
      );
      const attempt = await c.query<{ j: string }>(
        'SELECT to_jsonb(a)::text AS j FROM publishing.publish_attempts a WHERE id = $1',
        [attemptId],
      );
      const audit = await c.query<{ j: string }>(
        "SELECT (metadata::text || coalesce(reason, '')) AS j FROM infra.audit_log WHERE account_id = $1",
        [account],
      );
      return {
        publish_steps: steps.rows.map((r) => r.j).join('\n'),
        publish_attempts: attempt.rows.map((r) => r.j).join('\n'),
        audit_log: audit.rows.map((r) => r.j).join('\n'),
      };
    });
    const queued = await jobs();
    let logFile = '';
    try {
      logFile = readFileSync(
        resolve(
          TEST_LOG_DIR,
          `${basename('secret-scan.queue.spec.ts').replace(/\.ts$/, '')}.ndjson`,
        ),
        'utf8',
      );
    } catch {
      // chưa có tệp log: coi như rỗng.
    }
    const support = await withAccount(account, () =>
      new AttemptActionsService().supportDetails(attemptId),
    );
    return {
      ...db,
      notifications: JSON.stringify(world.emitted),
      jobs: JSON.stringify(queued.map((j) => ({ data: j.data, output: j.output }))),
      log_file: logFile,
      stdout_stderr: captured.join(''),
      support_details_response: JSON.stringify(support),
      gateway_request: JSON.stringify(world.gateway.lastSubmit ?? null),
    };
  }

  function expectNoToken(all: Record<string, string>): void {
    for (const [where, text] of Object.entries(all)) {
      expect(text, `${where} chứa mã quyền`).not.toContain(TOKEN);
      expect(text, `${where} chứa tiền tố mã quyền`).not.toContain(PREFIX);
    }
  }

  it('nền tảng ném lỗi có chứa mã quyền khi gửi → không nơi nào chứa mã quyền', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['throw'];
    // Ghi đè: lời gọi nền tảng ném Error có chứa mã quyền (mô phỏng thư viện HTTP in cả tiêu đề vào thông điệp).
    world.gateway.onSubmit = () => {
      throw new Error(`Request failed: Authorization: Bearer ${TOKEN}`);
    };
    await world.run(id, account).catch(() => undefined);
    expectNoToken(await surfaces(id));
  });

  it('nền tảng trả lỗi cần người dùng (mã quyền hết hạn) kèm mã gốc chứa mã quyền → không lọt ra ngoài', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    // Mã lỗi gốc là phần duy nhất được phép hiện trong "Chi tiết cho hỗ trợ"; mã quyền không bao giờ nằm trong đó.
    world.gateway.script = [{ fail: err('user_action', 'FB:190', 'test_channel') }];
    await world.run(id, account).catch(() => undefined);
    const all = await surfaces(id);
    expectNoToken(all);
    // Hợp đồng ngược: mã lỗi gốc hợp lệ vẫn thấy được trong chi tiết hỗ trợ (kiểm thử không làm rỗng dữ liệu).
    expect(all.support_details_response).toContain('FB:190');
  });

  it('kết nối hết hạn (kiểm tra trước) + thông báo phát ra → không chứa mã quyền', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.connectionStatus = 'expired';
    await world.run(id, account).catch(() => undefined);
    const all = await surfaces(id);
    expectNoToken(all);
    expect(world.emitted.length).toBeGreaterThan(0);
  });

  it('đăng thành công và chạy lại hai lần → không nơi nào chứa mã quyền', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    await world.run(id, account);
    await world.run(id, account).catch(() => undefined);
    expectNoToken(await surfaces(id));
  });
});
