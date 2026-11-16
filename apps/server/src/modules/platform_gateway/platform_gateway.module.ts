import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { notConfiguredProxy } from '../../core/gateways/not-configured';
import { registerDefaultAdapters } from './internal/adapters/registry';
import type { ConnectionStore } from './internal/connections/connection-store';
import {
  CONNECTIONS_SERVICE,
  ConnectionsController,
} from './internal/connections/connections.controller';
import { ConnectionsService } from './internal/connections/connections.service';
import { getFakePlatformStore, makeFakeAdapterFactory } from './internal/fake';
import { PlatformGatewayService } from './internal/gateway.service';
import { FakeCredentialVault, type CredentialVault } from './internal/vault/credential-vault';
import { PLATFORM_GATEWAY } from './public-api';

// Module Cổng nền tảng (005). Chọn bản cài đặt theo `PLATFORM_GATEWAY_DRIVER` (hiện chỉ `fake` – bản thật
// WBS 2.3) và kho trạng thái theo `FAKE_STATE_STORE`. Chưa chọn bản cài đặt (chỉ xảy ra khi dựng app bỏ
// qua `loadConfig`, vd kiểm thử production) → mọi thao tác báo "chưa cấu hình".

const PLATFORM_STORE = Symbol('PLATFORM_STORE');
const CREDENTIAL_VAULT = Symbol('CREDENTIAL_VAULT');

const NOT_CONFIGURED_STORE = notConfiguredProxy<ConnectionStore>(
  'PLATFORM_GATEWAY_DRIVER',
  'Cổng nền tảng',
);
const NOT_CONFIGURED_VAULT = notConfiguredProxy<CredentialVault>(
  'PLATFORM_GATEWAY_DRIVER',
  'Cổng nền tảng',
);

const providers = [
  {
    provide: PLATFORM_STORE,
    inject: [APP_CONFIG],
    useFactory: async (config: AppConfig): Promise<ConnectionStore> => {
      if (config.PLATFORM_GATEWAY_DRIVER !== 'fake') return NOT_CONFIGURED_STORE;
      const mode = config.FAKE_STATE_STORE ?? 'memory';
      const store = await getFakePlatformStore(mode);
      registerDefaultAdapters({
        driver: config.PLATFORM_GATEWAY_DRIVER,
        appEnv: config.APP_ENV,
        makeFake: makeFakeAdapterFactory(mode, store),
      });
      return store;
    },
  },
  {
    provide: CREDENTIAL_VAULT,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): CredentialVault =>
      config.PLATFORM_GATEWAY_DRIVER === 'fake' ? new FakeCredentialVault() : NOT_CONFIGURED_VAULT,
  },
  {
    provide: PLATFORM_GATEWAY,
    inject: [APP_CONFIG, PLATFORM_STORE, CREDENTIAL_VAULT],
    useFactory: (config: AppConfig, store: ConnectionStore, vault: CredentialVault) =>
      new PlatformGatewayService({
        store,
        vault,
        submitTimeoutMs: config.PLATFORM_SUBMIT_TIMEOUT_MS,
      }),
  },
];

/**
 * Module Cổng nền tảng (`platform_gateway`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 */
@Module({})
export class PlatformGatewayModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    if (unit === 'worker') {
      return {
        module: PlatformGatewayModule,
        global: true,
        providers,
        exports: [PLATFORM_GATEWAY],
      };
    }
    return {
      module: PlatformGatewayModule,
      // 012: `content` và `publishing` tiêm PLATFORM_GATEWAY (ranh giới do manifest + check:boundaries kiểm).
      global: true,
      controllers: [ConnectionsController],
      providers: [
        ...providers,
        {
          provide: CONNECTIONS_SERVICE,
          inject: [PLATFORM_STORE, CREDENTIAL_VAULT],
          useFactory: (store: ConnectionStore, vault: CredentialVault) =>
            new ConnectionsService(store, vault),
        },
      ],
      exports: [PLATFORM_GATEWAY],
    };
  }
}
