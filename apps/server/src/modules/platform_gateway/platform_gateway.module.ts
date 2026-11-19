import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { notConfiguredProxy } from '../../core/gateways/not-configured';
import { registerMetaAdapters } from './internal/adapters/meta/register';
import { registerDefaultAdapters } from './internal/adapters/registry';
import type { ConnectionStore } from './internal/connections/connection-store';
import {
  CONNECTIONS_SERVICE,
  ConnectionsController,
} from './internal/connections/connections.controller';
import { ConnectionsService } from './internal/connections/connections.service';
import { PgConnectionStore } from './internal/connections/pg-connection-store';
import { getFakePlatformStore, makeFakeAdapterFactory } from './internal/fake';
import { FeatureGate } from './internal/features/feature-gate';
import { PgFeatureReader } from './internal/features/pg-feature-reader';
import { PlatformGatewayService } from './internal/gateway.service';
import { GatewaySettings } from './internal/settings/gateway-settings';
import { PgGatewaySettingsReader } from './internal/settings/pg-gateway-settings-reader';
import { FakeCredentialVault, type CredentialVault } from './internal/vault/credential-vault';
import { EnvMasterKeyWrapper } from './internal/vault/env-master-key.wrapper';
import { KmsCredentialVault } from './internal/vault/kms-credential-vault';
import { KmsKeyWrapper } from './internal/vault/kms.wrapper';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../account';
import { NOTIFICATIONS, type NotificationsPublicApi } from '../notifications';
import { PLATFORM_GATEWAY } from './public-api';

// Module Cổng nền tảng (005). Chọn bản cài đặt theo `PLATFORM_GATEWAY_DRIVER` (hiện chỉ `fake` – bản thật
// WBS 2.3) và kho trạng thái theo `FAKE_STATE_STORE`. Chưa chọn bản cài đặt (chỉ xảy ra khi dựng app bỏ
// qua `loadConfig`, vd kiểm thử production) → mọi thao tác báo "chưa cấu hình".

const PLATFORM_STORE = Symbol('PLATFORM_STORE');
const CREDENTIAL_VAULT = Symbol('CREDENTIAL_VAULT');
// Dùng CHUNG một bộ nhớ đệm công tắc/cấu hình giữa API công khai của cổng và dịch vụ kết nối (≤ 60 giây).
const FEATURE_GATE = Symbol('FEATURE_GATE');
const GATEWAY_SETTINGS = Symbol('GATEWAY_SETTINGS');

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
      // 013: bộ chuyển đổi Meta THẬT (đăng ký sau bản giả để thay thế cùng loại kênh).
      const registerReal = () => {
        if (config.PLATFORM_ADAPTER_MODE !== 'real') return;
        registerMetaAdapters({
          baseUrl: config.META_GRAPH_BASE_URL,
          version: config.META_GRAPH_VERSION,
          timeoutMs: Math.min(
            config.META_GRAPH_TIMEOUT_MS,
            config.PLATFORM_SUBMIT_TIMEOUT_MS - 1_000,
          ),
          facebookReconcile: config.META_FACEBOOK_RECONCILE === 'true',
          instagramReconcile: config.META_INSTAGRAM_RECONCILE === 'true',
          facebookVideoMaxBytes: config.FACEBOOK_VIDEO_MAX_BYTES,
          oauth:
            config.FACEBOOK_APP_ID !== undefined && config.FACEBOOK_APP_SECRET !== undefined
              ? {
                  appId: config.FACEBOOK_APP_ID,
                  appSecret: config.FACEBOOK_APP_SECRET,
                  dialogBaseUrl: config.META_OAUTH_DIALOG_BASE_URL,
                  scopeGroups: config.CHANNEL_SCOPE_GROUPS,
                  scopeOverrides: {
                    facebook_page: config.CHANNEL_SCOPES_FACEBOOK_PAGE,
                    instagram: config.CHANNEL_SCOPES_INSTAGRAM,
                  },
                  tokenRefresh: config.META_TOKEN_REFRESH_ENABLED,
                }
              : null,
        });
      };
      // 010: driver `real` = bảng `platform_gateway.channel_connections` thật + bộ chuyển đổi thật.
      if (config.PLATFORM_GATEWAY_DRIVER === 'real') {
        registerReal();
        return new PgConnectionStore();
      }
      if (config.PLATFORM_GATEWAY_DRIVER !== 'fake') {
        registerReal();
        return NOT_CONFIGURED_STORE;
      }
      const mode = config.FAKE_STATE_STORE ?? 'memory';
      const store = await getFakePlatformStore(mode);
      registerDefaultAdapters({
        driver: config.PLATFORM_GATEWAY_DRIVER,
        appEnv: config.APP_ENV,
        makeFake: makeFakeAdapterFactory(mode, store),
      });
      registerReal();
      return store;
    },
  },
  {
    provide: CREDENTIAL_VAULT,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): CredentialVault => {
      // Chọn theo `CREDENTIAL_VAULT_DRIVER`; chưa cấu hình thì "chưa cấu hình" (không bao giờ im lặng dùng giả).
      // `assert-no-fakes` đã chặn `fake`/`env-master-key` ở production lúc khởi động.
      if (config.CREDENTIAL_VAULT_DRIVER === 'fake') return new FakeCredentialVault();
      if (config.CREDENTIAL_VAULT_DRIVER === 'env-master-key') {
        const master = config.CREDENTIAL_MASTER_KEY_B64;
        if (master === undefined) return NOT_CONFIGURED_VAULT;
        return new KmsCredentialVault(new EnvMasterKeyWrapper(master));
      }
      if (config.CREDENTIAL_VAULT_DRIVER === 'kms') {
        return new KmsCredentialVault(new KmsKeyWrapper(config.KMS_KEY_ID));
      }
      // Chưa chọn kho: driver cổng `fake` dùng bản giả, còn lại "chưa cấu hình".
      if (config.PLATFORM_GATEWAY_DRIVER === 'fake') return new FakeCredentialVault();
      return NOT_CONFIGURED_VAULT;
    },
  },
  { provide: FEATURE_GATE, useFactory: (): FeatureGate => new FeatureGate(new PgFeatureReader()) },
  {
    provide: GATEWAY_SETTINGS,
    useFactory: (): GatewaySettings => new GatewaySettings(new PgGatewaySettingsReader()),
  },
  {
    provide: PLATFORM_GATEWAY,
    inject: [
      APP_CONFIG,
      PLATFORM_STORE,
      CREDENTIAL_VAULT,
      NOTIFICATIONS,
      FEATURE_GATE,
      GATEWAY_SETTINGS,
    ],
    useFactory: (
      config: AppConfig,
      store: ConnectionStore,
      vault: CredentialVault,
      notifications: NotificationsPublicApi,
      features: FeatureGate,
      settings: GatewaySettings,
    ) =>
      new PlatformGatewayService({
        store,
        vault,
        submitTimeoutMs: config.PLATFORM_SUBMIT_TIMEOUT_MS,
        // 010: công tắc theo khách hàng (đọc lỗi ⇒ tắt), cấu hình dùng chung, thông báo "cần kết nối lại".
        features,
        settings,
        notifications,
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
          inject: [
            PLATFORM_STORE,
            CREDENTIAL_VAULT,
            FEATURE_GATE,
            GATEWAY_SETTINGS,
            ACCOUNT_PUBLIC_API,
          ],
          useFactory: (
            store: ConnectionStore,
            vault: CredentialVault,
            features: FeatureGate,
            settings: GatewaySettings,
            account: AccountPublicApi,
          ) =>
            new ConnectionsService(store, vault, () => new Date(), {
              features,
              settings,
              // Gói hết hạn/đang xóa ⇒ dừng kết nối mới (FR-033); module `account` sở hữu dữ liệu này (ADR-13).
              eligibility: () => account.getPublishingEligibility(),
            }),
        },
      ],
      exports: [PLATFORM_GATEWAY],
    };
  }
}
