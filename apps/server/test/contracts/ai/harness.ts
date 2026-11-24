import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { FakeStateStore } from '../../../src/dev/fake-components';
import { fakeAi, type FakeAiBundle } from '../../../src/modules/ai_gateway';
import type { DbBudgetStore } from '../../../src/modules/ai_gateway/internal/budget/db-budget-store';
import type {
  BudgetStore,
  Crossed,
} from '../../../src/modules/ai_gateway/internal/budget/budget-store';
import { makeFakeAiBundle } from '../../../src/modules/ai_gateway/internal/fake';
import { AiGatewayService } from '../../../src/modules/ai_gateway/internal/gateway.service';
import { AiSettings } from '../../../src/modules/ai_gateway/internal/settings/ai-settings';
import { scheduleStaleRelease } from '../../../src/modules/ai_gateway/jobs';
import { getAiCycleAnchor } from '../../../src/modules/account/internal/ai-cycle-anchor';
import type { Db } from '../../../src/core';
import { asOwner } from '../../db/helpers/db';
import { TEST_LOG_DIR } from '../../setup/log-capture';
import { composeDbStore, DbBudgetControl, type DbBudgetRow } from './db-control';

// Harness của bộ kiểm thử hợp đồng Cổng AI (005, R15; 015 T018 thêm chế độ `db`).
// - `memory`  : kho bộ nhớ (pnpm test).
// - `sandbox` : kho bảng giả lập sandbox.ai_fake_* (pnpm test:db, test/contracts/ai/ai.sandbox.contract.spec.ts).
// - `db`      : kho THẬT `DbBudgetStore` trên bảng ai_gateway.* (pnpm test:db, ai.db.contract.spec.ts).
//   Nhà cung cấp vẫn là bản giả (đủ để kiểm kho + trình tự của Cổng); phần điều khiển (đặt số, lùi giờ, đọc sổ) do
//   `db-control.ts` thực hiện trực tiếp trên bảng thật bằng vai trò owner.

export type AiHarnessMode = FakeStateStore | 'db';

/** Tùy chọn mà harness giả định `DbBudgetStore` (T025) nhận – chỉnh DUY NHẤT ở `makeDbStore` nếu dev đặt tên khác. */
export interface DbStoreOptions {
  systemWeeklyCap: number;
  /** Gọi trong giao dịch giữ chỗ để hẹn `ai_gateway.release_stale` +15 phút (T025). */
  onReserved: typeof scheduleStaleRelease;
  settings: AiSettings;
  /** Phần của `AccountPublicApi` mà kho dùng để lấy mốc chu kỳ (T028). */
  accountApi: { getAiCycleAnchor: () => Promise<{ anchorDate: string } | null> };
  /** Chỉ kiểm thử: tuyến + nguồn giá thay thế (vd đổi giá `cheap_vision` mà không ghi bảng giá chỉ-thêm). */
  routes?: NonNullable<ConstructorParameters<typeof DbBudgetStore>[0]['routes']>;
  prices?: NonNullable<ConstructorParameters<typeof DbBudgetStore>[0]['prices']>;
}

/**
 * Dựng `DbBudgetStore` thật. Nạp động theo đường dẫn biến (không import tĩnh) để các bộ hợp đồng `memory`/`sandbox`
 * vẫn chạy được trước khi T025 có mã. Chưa có mã → ném lỗi rõ ràng (kiểm thử `db` THẤT BẠI đúng lý do).
 */
export async function makeDbStore(overrides: Partial<DbStoreOptions> = {}): Promise<BudgetStore> {
  let mod: { DbBudgetStore?: new (opts: DbStoreOptions) => BudgetStore };
  try {
    mod = await import('../../../src/modules/ai_gateway/internal/budget/db-budget-store');
  } catch (err) {
    throw new Error(
      `Chưa có DbBudgetStore (T025): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (mod.DbBudgetStore === undefined)
    throw new Error('db-budget-store.ts chưa xuất DbBudgetStore');
  return new mod.DbBudgetStore({
    systemWeeklyCap: 2_000_000,
    onReserved: scheduleStaleRelease,
    settings: new AiSettings({ ttlMs: 0 }),
    accountApi: { getAiCycleAnchor },
    ...overrides,
  });
}

export interface AiHarness {
  mode: AiHarnessMode;
  /** Mỗi lần gọi một tài khoản MỚI (cô lập ca kiểm thử). */
  newAccount(): Promise<string>;
  inAccount<T>(accountId: string, fn: () => Promise<T>): Promise<T>;
  inSystem<T>(fn: () => Promise<T>): Promise<T>;
  bundle: FakeAiBundle;
  fake: ReturnType<typeof fakeAi>;
  gateway(opts?: {
    providerTimeoutMs?: number;
    firstTokenTimeoutMs?: number;
    onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
  }): AiGatewayService;
  logText(): string;
  /** Có giao dịch CSDL thật (kiểm được giao dịch hủy, đo thời gian giữ chỗ). */
  hasRealTx: boolean;
  /** Kho có hiểu `requestId` (sandbox cũ thì không – 015 FR-037a nằm ở kho `memory` và `db`). */
  supportsRequestId: boolean;
  /** Phát sự kiện ngưỡng qua Thông báo thật của chế độ (memory: bộ phát bộ nhớ; sandbox: hàng chờ). */
  notify: {
    onCrossed: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
    /** Số sự kiện `type` đã phát của tài khoản trong ngữ cảnh. */
    count(type: 'ai_usage_80' | 'ai_usage_100'): Promise<number>;
  };
  /** Chỉ chế độ `db`: chu kỳ theo mốc của tài khoản (015 mục 16). */
  db?: {
    /** Tạo tài khoản `active` có mốc chu kỳ (ngày UTC+7 `YYYY-MM-DD`) = `anchorDate`. */
    accountWithAnchor(anchorDate: string): Promise<string>;
    /** Mọi dòng `ai_budgets` của tài khoản trong ngữ cảnh. */
    budgetRows(): Promise<DbBudgetRow[]>;
    /** Dòng ngân sách chu kỳ cũ đã cạn trần + đã báo 80/100. */
    seedExhaustedPastCycle(): Promise<string>;
    /**
     * 015 T036/T037: Cổng trên một kho `DbBudgetStore` MỚI với tuyến/nguồn giá thay thế (vd tuyến trỏ tới mô hình riêng của
     * ca kiểm thử, có dòng giá riêng) – không đụng bảng `model_routes` dùng chung. Nhà cung cấp vẫn là bản giả của harness.
     */
    gatewayWith(
      overrides: Partial<DbStoreOptions>,
      opts?: { providerTimeoutMs?: number; firstTokenTimeoutMs?: number },
    ): Promise<AiGatewayService>;
  };
}

export async function makeAiHarness(
  mode: AiHarnessMode,
  createAccount: () => Promise<string>,
  notify: AiHarness['notify'],
  storeOverrides: Partial<DbStoreOptions> = {},
): Promise<AiHarness> {
  // Kho kịch bản nhà cung cấp giả: chế độ `db` dùng bảng sandbox.fake_scenarios như `sandbox`.
  const scenarioMode: FakeStateStore = mode === 'db' ? 'sandbox' : mode;
  const base = await makeFakeAiBundle(scenarioMode, { systemWeeklyCap: 2_000_000 });
  let bundle: FakeAiBundle = base;
  let dbControl: DbBudgetControl | undefined;
  if (mode === 'db') {
    const raw = await makeDbStore(storeOverrides);
    dbControl = new DbBudgetControl(raw);
    bundle = { ...base, store: composeDbStore(raw, dbControl) };
  }
  const harness: AiHarness = {
    mode,
    newAccount: createAccount,
    inAccount: (accountId, fn) => runWithJobContext({ traceId: uuidV7(), accountId }, fn),
    inSystem: (fn) => runWithJobContext({ traceId: uuidV7() }, fn),
    bundle,
    fake: fakeAi(scenarioMode, bundle.store),
    gateway: (o = {}) =>
      new AiGatewayService({
        store: bundle.store,
        prices: bundle.prices,
        primary: bundle.primary,
        fallback: bundle.fallback,
        providerTimeoutMs: o.providerTimeoutMs ?? 300,
        firstTokenTimeoutMs: o.firstTokenTimeoutMs ?? 300,
        ...(o.onCrossed !== undefined ? { onCrossed: o.onCrossed } : {}),
      }),
    logText() {
      const file = resolve(
        TEST_LOG_DIR,
        `${basename(expect.getState().testPath ?? '').replace(/\.[cm]?ts$/, '')}.ndjson`,
      );
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    },
    hasRealTx: mode === 'sandbox' || mode === 'db',
    supportsRequestId: mode !== 'sandbox',
    notify,
  };
  if (dbControl !== undefined) {
    const control = dbControl;
    harness.db = {
      async accountWithAnchor(anchorDate) {
        const id = await createAccount();
        // Giữa trưa UTC+7 để phép đổi sang ngày UTC+7 của `getAiCycleAnchor` không lệch ngày.
        await asOwner((c) =>
          c.query('UPDATE account.accounts SET created_at = $2::timestamptz WHERE id = $1', [
            id,
            `${anchorDate}T12:00:00+07:00`,
          ]),
        );
        return id;
      },
      budgetRows: () => control.budgetRows(),
      seedExhaustedPastCycle: () => control.seedExhaustedPastCycle(),
      async gatewayWith(overrides, o = {}) {
        const raw = await makeDbStore({ ...storeOverrides, ...overrides });
        return new AiGatewayService({
          store: composeDbStore(raw, control),
          prices: base.prices,
          primary: base.primary,
          fallback: base.fallback,
          providerTimeoutMs: o.providerTimeoutMs ?? 300,
          firstTokenTimeoutMs: o.firstTokenTimeoutMs ?? 300,
        });
      },
    };
  }
  return harness;
}
