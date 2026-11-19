import { type DynamicModule, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { notConfiguredProxy } from '../../core/gateways/not-configured';
import { guardAdapter } from './internal/adapters/feature-guarded-adapter';
import { TiktokAdapter } from './internal/adapters/tiktok/tiktok.adapter';
import { TiktokClient } from './internal/adapters/tiktok/tiktok-client';
import { registerMetaAdapters } from './internal/adapters/meta/register';
import { registerAdapter, registerDefaultAdapters } from './internal/adapters/registry';
import { registerJobHandler } from '../queue';
import { recordFeatureReadFailed, recordRefresh, registerChannelGauges } from './internal/metrics';
import { writeChannelAudit } from './internal/connections/channel-audit';
import { createCheckConnectionHandler } from './internal/maintenance/check-connection.handler';
import { runCleanupConnectData } from './internal/maintenance/cleanup.handler';
import { runChannelMaintenance } from './internal/maintenance/due-connections';
import { createDisconnectAllHandler } from './internal/maintenance/disconnect-all.handler';
import {
  channelMaintenance,
  checkConnection,
  cleanupConnectData,
  defineChannelSchedules,
  disconnectAll,
} from './internal/maintenance/jobs';
import type { ConnectionStore } from './internal/connections/connection-store';
import {
  CONNECTIONS_SERVICE,
  ConnectionsController,
} from './internal/connections/connections.controller';
import { FEATURES_SERVICE, FeaturesService } from './internal/features/features.service';
import { StaffFeaturesController } from './internal/features/staff-features.controller';
import { StaffChannelsController } from './internal/connections/staff-channels.controller';
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
    inject: [APP_CONFIG, FEATURE_GATE],
    useFactory: async (config: AppConfig, gate: FeatureGate): Promise<ConnectionStore> => {
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
      // 010 T079: TikTok THẬT – luôn bọc `FeatureGuardedAdapter` (công tắc `channel.tiktok` kiểm TRƯỚC khi chạm mạng).
      const registerTiktok = () => {
        if (
          config.PLATFORM_ADAPTER_MODE !== 'real' ||
          config.TIKTOK_CLIENT_KEY === undefined ||
          config.TIKTOK_CLIENT_SECRET === undefined
        ) {
          return;
        }
        const { TIKTOK_CLIENT_KEY: clientKey, TIKTOK_CLIENT_SECRET: clientSecret } = config;
        registerAdapter('tiktok', () =>
          guardAdapter(
            new TiktokAdapter({
              client: new TiktokClient({
                baseUrl: config.TIKTOK_BASE_URL,
                timeoutMs: config.TIKTOK_TIMEOUT_MS,
              }),
              clientKey,
              clientSecret,
              scopes: (config.CHANNEL_SCOPES_TIKTOK ?? 'user.info.basic,video.publish,video.upload')
                .split(',')
                .map((x) => x.trim())
                .filter((x) => x !== ''),
            }),
            (accountId) => gate.isEnabled(accountId, 'channel.tiktok'),
          ),
        );
      };
      // 010: driver `real` = bảng `platform_gateway.channel_connections` thật + bộ chuyển đổi thật.
      if (config.PLATFORM_GATEWAY_DRIVER === 'real') {
        registerReal();
        registerTiktok();
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
      registerTiktok();
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
  {
    provide: FEATURE_GATE,
    useFactory: (): FeatureGate =>
      new FeatureGate(new PgFeatureReader(), {
        onReadFailed: () => {
          recordFeatureReadFailed();
        },
      }),
  },
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

let handlersRegistered = false;

/** Đăng ký bộ xử lý việc nền (010 T058–T063) – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
@Injectable()
class PlatformGatewayWorkerHandlers implements OnModuleInit {
  constructor(
    @Inject(PLATFORM_STORE) private readonly store: ConnectionStore,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVault,
    @Inject(FEATURE_GATE) private readonly features: FeatureGate,
    @Inject(GATEWAY_SETTINGS) private readonly settings: GatewaySettings,
    @Inject(NOTIFICATIONS) private readonly notifications: NotificationsPublicApi,
    @Inject(ACCOUNT_PUBLIC_API) private readonly account: AccountPublicApi,
  ) {}

  onModuleInit(): void {
    if (handlersRegistered) return;
    handlersRegistered = true;
    const check = createCheckConnectionHandler({
      store: this.store,
      vault: this.vault,
      settings: this.settings,
      features: this.features,
      notifications: this.notifications,
      eligibility: () => this.account.getPublishingEligibility(),
      audit: writeChannelAudit,
    });
    registerJobHandler(checkConnection, async (payload) => {
      // Mẫu số tỷ lệ làm mới thành công (SC-005): chỉ đếm khi thật sự đã kiểm tra nền tảng; lỗi hạ tầng của ta ⇒ failed.
      let channelType = 'unknown';
      try {
        const conn = await this.store.getConnection(payload.connectionId);
        if (conn !== null) channelType = conn.channelType;
        const outcome = await check(payload.connectionId);
        if (outcome === 'ok' || outcome === 'changed') recordRefresh(channelType, 'ok');
        else if (outcome === 'deferred') recordRefresh(channelType, 'deferred');
      } catch (err) {
        recordRefresh(channelType, 'failed');
        throw err;
      }
    });
    const connections = new ConnectionsService(this.store, this.vault, () => new Date(), {
      features: this.features,
      settings: this.settings,
      eligibility: () => this.account.getPublishingEligibility(),
      audit: writeChannelAudit,
      notifications: this.notifications,
    });
    const disconnectAllHandler = createDisconnectAllHandler(connections);
    registerJobHandler(disconnectAll, async () => {
      await disconnectAllHandler();
    });
    registerJobHandler(channelMaintenance, async () => {
      const cfg = await this.settings.get();
      await runChannelMaintenance({ batchLimit: cfg.checkBatchLimit });
    });
    registerJobHandler(cleanupConnectData, async () => {
      await runCleanupConnectData();
    });
    defineChannelSchedules();
    registerChannelGauges();
  }
}

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
        providers: [...providers, PlatformGatewayWorkerHandlers],
        exports: [PLATFORM_GATEWAY],
      };
    }
    return {
      module: PlatformGatewayModule,
      // 012: `content` và `publishing` tiêm PLATFORM_GATEWAY (ranh giới do manifest + check:boundaries kiểm).
      global: true,
      controllers: [ConnectionsController, StaffChannelsController, StaffFeaturesController],
      providers: [
        ...providers,
        {
          provide: FEATURES_SERVICE,
          inject: [FEATURE_GATE],
          useFactory: (gate: FeatureGate): FeaturesService => new FeaturesService(gate),
        },
        {
          provide: CONNECTIONS_SERVICE,
          inject: [
            PLATFORM_STORE,
            CREDENTIAL_VAULT,
            FEATURE_GATE,
            GATEWAY_SETTINGS,
            ACCOUNT_PUBLIC_API,
            NOTIFICATIONS,
          ],
          useFactory: (
            store: ConnectionStore,
            vault: CredentialVault,
            features: FeatureGate,
            settings: GatewaySettings,
            account: AccountPublicApi,
            notifications: NotificationsPublicApi,
          ) =>
            new ConnectionsService(store, vault, () => new Date(), {
              features,
              settings,
              // Gói hết hạn/đang xóa ⇒ dừng kết nối mới (FR-033); module `account` sở hữu dữ liệu này (ADR-13).
              eligibility: () => account.getPublishingEligibility(),
              audit: writeChannelAudit,
              notifications,
            }),
        },
      ],
      exports: [PLATFORM_GATEWAY],
    };
  }
}
