import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, type Db } from '../../core';
import { notConfiguredProxy } from '../../core/gateways/not-configured';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../account';
import { AiAdminController } from './internal/admin/admin.controller';
import { InvoicesService } from './internal/admin/invoices.service';
import { AiSupportController } from './internal/admin/support.controller';
import { PricingService } from './internal/admin/pricing.service';
import { RoutesService } from './internal/admin/routes.service';
import { SettingsService } from './internal/admin/settings.service';
import type { Crossed } from './internal/budget/budget-store';
import { DbBudgetStore } from './internal/budget/db-budget-store';
import { makeFakeAiBundle, type FakeAiBundle } from './internal/fake';
import { AiGatewayService } from './internal/gateway.service';
import { openReservationsCount } from './internal/db/summary-functions';
import { registerOpenReservationsGauge } from './internal/metrics';
import { DbPriceSource } from './internal/prices/db-price-source';
import type { AiProviderAdapter } from './internal/providers/provider';
import {
  buildAdapterIfKeyed,
  buildAdapters,
  LocalTokenCounter,
} from './internal/providers/registry';
import { RouteBook } from './internal/routing/route-book';
import { AiSettings } from './internal/settings/ai-settings';
import {
  defineAlertSchedules,
  defineStaleSystemSchedule,
  registerAiJobHandlers,
  scheduleStaleRelease,
} from './jobs';
import { NOTIFICATIONS, type NotificationsPublicApi } from '../notifications';
import {
  ACTIVE_INDUSTRIES_SOURCE,
  AI_GATEWAY,
  INDUSTRY_ACCOUNTS_SOURCE,
  type ActiveIndustriesSource,
  type AiGatewayPublicApi,
  type IndustryAccountsSource,
} from './public-api';

// Module Cổng AI (005, 015). Chọn bản cài đặt theo `AI_GATEWAY_DRIVER` (`fake` | `real`) và, ở `fake`, kho
// ngân sách theo `FAKE_STATE_STORE`. `real`: nối bảng giá, tuyến, cấu hình từ CSDL, kho ngân sách thật (T025) và bộ
// chuyển đổi nhà cung cấp chọn theo `provider` của `model_routes` (T049; thiếu khóa cho tuyến đã bật → lỗi khởi động).
// Worker: bộ xử lý trả giữ chỗ treo.

export const AI_FAKE_BUNDLE = Symbol('AI_FAKE_BUNDLE');
/** Thành phần của driver `real` (015): giá, tuyến, cấu hình, cổng đảo ngược (có thể chưa có hiện thực). */
export const AI_REAL_PARTS = Symbol('AI_REAL_PARTS');

export interface RealAiParts {
  prices: DbPriceSource;
  routes: RouteBook;
  settings: AiSettings;
  activeIndustries: ActiveIndustriesSource | undefined;
  industryAccounts: IndustryAccountsSource | undefined;
}
/** Kho ngân sách thật của driver `real` (T025). */
export const AI_DB_STORE = Symbol('AI_DB_STORE');
/** Hàm phát sự kiện ngưỡng trong giao dịch quyết toán – Thông báo nối vào ở T080. */
export const AI_ON_CROSSED = Symbol('AI_ON_CROSSED');

export type OnCrossed = (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;

/** Phát `ai_usage_80` / `ai_usage_100` cho từng mốc vừa vượt, trên cùng `tx` của quyết toán. */
export function makeOnCrossed(notifications: NotificationsPublicApi): OnCrossed {
  return async (tx, crossed, cycleStart) => {
    for (const p of crossed) {
      await notifications.emit(tx, {
        type: p === 80 ? 'ai_usage_80' : 'ai_usage_100',
        refs: { cycleStart },
        params: { percent: p },
      });
    }
  };
}

/** Host được tải âm thanh STT: host kho tệp S3 (công khai + nội bộ) + `AI_STT_ALLOWED_HOSTS`. Rỗng → từ chối mọi URL. */
function sttAllowedHosts(config: AppConfig): string[] {
  const hosts: string[] = [];
  for (const url of [config.S3_PUBLIC_ENDPOINT, config.S3_ENDPOINT]) {
    if (url === undefined) continue;
    try {
      hosts.push(new URL(url).hostname.toLowerCase());
    } catch {
      /* cấu hình sai đã bị lược đồ chặn */
    }
  }
  for (const h of (config.AI_STT_ALLOWED_HOSTS ?? '').split(',')) {
    const t = h.trim().toLowerCase();
    if (t !== '') hosts.push(t);
  }
  return hosts;
}

@Module({})
export class AiGatewayModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: AiGatewayModule,
      // Điểm cuối quản trị cấu hình (015 US3): chỉ `admin`; thao tác ghi đi qua hàm SQL + kiểm toán cùng giao dịch.
      controllers: [AiAdminController, AiSupportController],
      providers: [
        PricingService,
        SettingsService,
        RoutesService,
        InvoicesService,
        {
          // Sự kiện 80/100% tạo TRONG giao dịch quyết toán (nguyên tắc IV, research R7) – không bao giờ
          // emit sau khi settle đã trả.
          provide: AI_ON_CROSSED,
          inject: [NOTIFICATIONS],
          useFactory: (notifications: NotificationsPublicApi): OnCrossed =>
            makeOnCrossed(notifications),
        },
        {
          // Driver `real`: nối DbPriceSource (T012), RouteBook (T013), AiSettings (T011). KHÔNG nối DbBudgetStore
          // (T025). Cổng đảo ngược do module khác cắm sau bằng token Nest (không bắt buộc).
          provide: AI_REAL_PARTS,
          inject: [
            APP_CONFIG,
            { token: ACTIVE_INDUSTRIES_SOURCE, optional: true },
            { token: INDUSTRY_ACCOUNTS_SOURCE, optional: true },
          ],
          useFactory: (
            config: AppConfig,
            activeIndustries: ActiveIndustriesSource | undefined,
            industryAccounts: IndustryAccountsSource | undefined,
          ): RealAiParts | null => {
            if (config.AI_GATEWAY_DRIVER !== 'real') return null;
            // Một TTL duy nhất cho giá, tuyến, cấu hình; kẹp 60 s (quy tắc admin `effectiveFrom ≥ now + TTL`).
            const ttlMs = Math.min(Math.max(0, config.AI_PRICE_CACHE_TTL_MS), 60_000);
            return {
              prices: new DbPriceSource({ ttlMs }),
              routes: new RouteBook({ ttlMs }),
              settings: new AiSettings({ ttlMs }),
              activeIndustries,
              industryAccounts,
            };
          },
        },
        {
          // Driver `real`: kho ngân sách thật trên bảng `ai_gateway.*` (T025–T028). Mốc chu kỳ qua AccountPublicApi.
          provide: AI_DB_STORE,
          inject: [APP_CONFIG, AI_REAL_PARTS, { token: ACCOUNT_PUBLIC_API, optional: true }],
          useFactory: (
            config: AppConfig,
            real: RealAiParts | null,
            account: AccountPublicApi | undefined,
          ): DbBudgetStore | null => {
            if (real === null) return null;
            if (account === undefined) {
              throw new Error(
                'AI_GATEWAY_DRIVER=real: thiếu AccountPublicApi để lấy mốc chu kỳ AI',
              );
            }
            return new DbBudgetStore({
              systemWeeklyCap: config.AI_SYSTEM_WEEKLY_CAP_MICRO_USD,
              // Trần tuần = số ngành × mức/ngành; thiếu nguồn → trần tạm + `ai.industry_source_missing` (US7, R-11).
              activeIndustries: real.activeIndustries,
              onReserved: scheduleStaleRelease,
              settings: real.settings,
              accountApi: account,
              routes: real.routes,
              prices: real.prices,
            });
          },
        },
        {
          provide: AI_FAKE_BUNDLE,
          inject: [APP_CONFIG],
          useFactory: async (config: AppConfig): Promise<FakeAiBundle | null> => {
            if (config.AI_GATEWAY_DRIVER !== 'fake') return null;
            const mode = config.FAKE_STATE_STORE ?? 'memory';
            return makeFakeAiBundle(mode, {
              systemWeeklyCap: config.AI_SYSTEM_WEEKLY_CAP_MICRO_USD,
              // sandbox: hẹn việc trả giữ chỗ treo trong cùng giao dịch giữ chỗ.
              ...(mode === 'sandbox' ? { onReserved: scheduleStaleRelease } : {}),
            });
          },
        },
        {
          provide: AI_GATEWAY,
          inject: [
            APP_CONFIG,
            AI_FAKE_BUNDLE,
            AI_ON_CROSSED,
            AI_REAL_PARTS,
            AI_DB_STORE,
            { token: ACCOUNT_PUBLIC_API, optional: true },
          ],
          useFactory: async (
            config: AppConfig,
            bundle: FakeAiBundle | null,
            onCrossed: OnCrossed | undefined,
            real: RealAiParts | null,
            dbStore: DbBudgetStore | null,
            account: AccountPublicApi | undefined,
          ): Promise<AiGatewayPublicApi> => {
            if (real !== null && dbStore !== null) {
              // Việc dọn giữ chỗ treo, phân bổ chi phí xu hướng, cảnh báo và đối soát chạy trên kho thật (Worker).
              if (unit === 'worker') {
                registerAiJobHandlers(dbStore, onCrossed, {
                  industryAccounts: real.industryAccounts,
                  accounts: account,
                });
                defineAlertSchedules();
                // Giữ chỗ treo của ngân sách HỆ THỐNG (xu hướng) không có việc hẹn theo giữ chỗ (không có ngữ cảnh tài
                // khoản để hẹn việc tenant) → dọn bằng lịch mỗi phút; thiếu lịch này `reserved` rò vĩnh viễn.
                defineStaleSystemSchedule();
                // Gauge giữ chỗ chưa đóng (tổng tenant + hệ thống, không nhãn tài khoản) đọc qua hàm SQL của bể `system`.
                registerOpenReservationsGauge(async () => {
                  const { tenantOpen, systemOpen } = await openReservationsCount();
                  return tenantOpen + systemOpen;
                });
              }
              // Bộ chuyển đổi theo `provider` của tuyến ĐÃ BẬT trong `model_routes`; thiếu khóa/nhà cung cấp lạ → dừng khởi động
              // rõ ràng (chỉ nêu tên biến môi trường, không in khóa), KHÔNG lặng lẽ rơi về bản giả lập.
              const buildOpts = {
                keys: { anthropic: config.ANTHROPIC_API_KEY, openai: config.OPENAI_API_KEY },
                safetyPercent: config.AI_TOKEN_ESTIMATE_SAFETY_PERCENT,
                sttAllowedHosts: sttAllowedHosts(config),
              };
              const adapters = buildAdapters(await real.routes.enabledProviders(), buildOpts);
              // Admin có thể trỏ tuyến sang nhà cung cấp chưa dựng lúc khởi động: dựng LƯỜI khi gặp (nếu khóa đã nạp trong
              // cấu hình); thiếu khóa → `undefined` → AI_NOT_CONFIGURED (đặt khóa + khởi động lại, xem ai-gateway-providers.md).
              const adapterFor = (provider: string): AiProviderAdapter | undefined => {
                const known = adapters.get(provider);
                if (known !== undefined) return known;
                const lazy = buildAdapterIfKeyed(provider, buildOpts);
                if (lazy !== undefined) adapters.set(provider, lazy);
                return lazy;
              };
              // Ước tính token đầu vào là cục bộ, không phụ thuộc nhà cung cấp nào được bật.
              const counter = new LocalTokenCounter(config.AI_TOKEN_ESTIMATE_SAFETY_PERCENT);
              return new AiGatewayService({
                store: dbStore,
                primary: counter,
                fallback: counter,
                adapterFor,
                providerTimeoutMs: config.AI_PROVIDER_TIMEOUT_MS,
                firstTokenTimeoutMs: config.AI_FIRST_TOKEN_TIMEOUT_MS,
                ...(onCrossed !== undefined ? { onCrossed } : {}),
              });
            }
            if (bundle === null) {
              return notConfiguredProxy<AiGatewayPublicApi>('AI_GATEWAY_DRIVER', 'Cổng AI');
            }
            if (unit === 'worker') {
              registerAiJobHandlers(bundle.store, onCrossed);
              if (config.FAKE_STATE_STORE === 'sandbox') defineStaleSystemSchedule();
            }
            return new AiGatewayService({
              store: bundle.store,
              prices: bundle.prices,
              primary: bundle.primary,
              fallback: bundle.fallback,
              providerTimeoutMs: config.AI_PROVIDER_TIMEOUT_MS,
              firstTokenTimeoutMs: config.AI_FIRST_TOKEN_TIMEOUT_MS,
              ...(onCrossed !== undefined ? { onCrossed } : {}),
            });
          },
        },
      ],
      exports: [AI_GATEWAY, AI_FAKE_BUNDLE],
    };
  }
}
