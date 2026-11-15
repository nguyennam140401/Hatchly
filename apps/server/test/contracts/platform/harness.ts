import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect } from 'vitest';
import { executionStorage } from '../../../src/core/context/execution-storage';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { FakeStateStore } from '../../../src/dev/fake-components';
import { getScenarioStore } from '../../../src/dev/scenarios';
import { fakePlatform, getFakePlatformStore } from '../../../src/modules/platform_gateway';
import type { ChannelType } from '../../../src/modules/platform_gateway';
import {
  clearAdapters,
  registerDefaultAdapters,
} from '../../../src/modules/platform_gateway/internal/adapters/registry';
import { ConnectionsService } from '../../../src/modules/platform_gateway/internal/connections/connections.service';
import { makeFakeAdapterFactory } from '../../../src/modules/platform_gateway/internal/fake';
import type { FakeStep } from '../../../src/modules/platform_gateway/internal/fake/scenarios';
import { PlatformGatewayService } from '../../../src/modules/platform_gateway/internal/gateway.service';
import {
  FakeCredentialVault,
  newFakeToken,
} from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import { TEST_LOG_DIR } from '../../setup/log-capture';

// Harness của bộ kiểm thử hợp đồng Cổng nền tảng (005, R15). Bản thật sau này (WBS 2.3) cung cấp
// harness của mình (vd máy chủ HTTP giả của Graph API) với cùng giao diện.

export interface Party {
  accountId: string;
  userId: string;
}

export interface PlatformHarness {
  mode: FakeStateStore;
  a: Party;
  b: Party;
  /** Chạy trong ngữ cảnh yêu cầu đã đăng nhập (chủ) của một tài khoản. */
  as<T>(who: Party, fn: () => Promise<T>): Promise<T>;
  /** Tạo kết nối trực tiếp (bỏ qua luồng OAuth) trong tài khoản đang chạy. */
  createConnection(
    channelType: ChannelType,
    opts?: { status?: 'disconnected'; expiresInMs?: number },
  ): Promise<string>;
  script(target: string, steps: FakeStep[]): Promise<void>;
  setOauthPages(
    pages: { externalId: string; displayName: string; eligible: boolean }[],
  ): Promise<void>;
  publishedCount(hash: string): Promise<number>;
  gateway(submitTimeoutMs?: number): PlatformGatewayService;
  connections(): ConnectionsService;
  /** Toàn bộ nhật ký đã ghi của tệp kiểm thử (quét chuỗi mồi). */
  logText(): string;
}

export async function makePlatformHarness(
  mode: FakeStateStore,
  accounts: { a: string; b: string },
): Promise<PlatformHarness> {
  const store = await getFakePlatformStore(mode);
  const vault = new FakeCredentialVault();
  clearAdapters();
  registerDefaultAdapters({
    driver: 'fake',
    appEnv: 'test',
    makeFake: makeFakeAdapterFactory(mode, store),
  });
  const a = { accountId: accounts.a, userId: uuidV7() };
  const b = { accountId: accounts.b, userId: uuidV7() };
  const control = fakePlatform(mode);

  const as = <T>(who: Party, fn: () => Promise<T>) =>
    executionStorage.run(
      {
        traceId: uuidV7(),
        source: 'request',
        accountId: who.accountId,
        actor: {
          kind: 'user',
          userId: who.userId,
          accountId: who.accountId,
          role: 'owner',
          emailVerified: true,
          sessionId: uuidV7(),
          detached: false,
        },
      },
      fn,
    );

  return {
    mode,
    a,
    b,
    as,
    async createConnection(channelType, opts) {
      const { connection } = await store.insertConnection({
        channelType,
        externalId: `${channelType}-${uuidV7()}`,
        displayName: `Trang thử ${channelType}`,
        tokenCiphertext: await vault.encrypt(newFakeToken()),
        tokenExpiresAt: new Date(Date.now() + (opts?.expiresInMs ?? 30 * 86_400_000)),
      });
      if (opts?.status === 'disconnected') await store.disconnect(connection.id);
      return connection.id;
    },
    script: (target, steps) => control.script(target, steps),
    async setOauthPages(pages) {
      const scenarios = await getScenarioStore(mode);
      await scenarios.put({
        component: 'platform',
        target: 'oauth',
        spec: { pages },
        remainingUses: 1,
      });
    },
    publishedCount: (hash) => control.publishedCount(hash),
    gateway: (submitTimeoutMs = 200) =>
      new PlatformGatewayService({ store, vault, submitTimeoutMs }),
    connections: () => new ConnectionsService(store, vault),
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
  };
}
