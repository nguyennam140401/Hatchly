import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { FakeStateStore } from '../../../src/dev/fake-components';
import { fakeAi, type FakeAiBundle } from '../../../src/modules/ai_gateway';
import type { Crossed } from '../../../src/modules/ai_gateway/internal/budget/budget-store';
import { makeFakeAiBundle } from '../../../src/modules/ai_gateway/internal/fake';
import { AiGatewayService } from '../../../src/modules/ai_gateway/internal/gateway.service';
import type { Db } from '../../../src/core';
import { TEST_LOG_DIR } from '../../setup/log-capture';

// Harness của bộ kiểm thử hợp đồng Cổng AI (005, R15). Bản thật WBS 3.1 cung cấp harness của mình.

export interface AiHarness {
  mode: FakeStateStore;
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
  /** Phát sự kiện ngưỡng qua Thông báo thật của chế độ (memory: bộ phát bộ nhớ; sandbox: hàng chờ). */
  notify: {
    onCrossed: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
    /** Số sự kiện `type` đã phát của tài khoản trong ngữ cảnh. */
    count(type: 'ai_usage_80' | 'ai_usage_100'): Promise<number>;
  };
}

export async function makeAiHarness(
  mode: FakeStateStore,
  createAccount: () => Promise<string>,
  notify: AiHarness['notify'],
): Promise<AiHarness> {
  const bundle = await makeFakeAiBundle(mode, { systemWeeklyCap: 2_000_000 });
  return {
    mode,
    newAccount: createAccount,
    inAccount: (accountId, fn) => runWithJobContext({ traceId: uuidV7(), accountId }, fn),
    inSystem: (fn) => runWithJobContext({ traceId: uuidV7() }, fn),
    bundle,
    fake: fakeAi(mode, bundle.store),
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
    hasRealTx: mode === 'sandbox',
    notify,
  };
}
