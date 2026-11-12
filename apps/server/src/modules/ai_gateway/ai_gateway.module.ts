import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, type Db } from '../../core';
import type { Crossed } from './internal/budget/budget-store';
import { makeFakeAiBundle, type FakeAiBundle } from './internal/fake';
import { AiGatewayService } from './internal/gateway.service';
import { defineStaleSystemSchedule, registerAiJobHandlers, scheduleStaleRelease } from './jobs';
import { NOTIFICATIONS, type NotificationsPublicApi } from '../notifications';
import { AI_GATEWAY, type AiGatewayPublicApi } from './public-api';

// Module Cổng AI (005). Chọn bản cài đặt theo `AI_GATEWAY_DRIVER` (hiện chỉ `fake` – bản thật WBS 3.1) và
// kho ngân sách theo `FAKE_STATE_STORE`. Worker: bộ xử lý trả giữ chỗ treo.

export const AI_FAKE_BUNDLE = Symbol('AI_FAKE_BUNDLE');
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

function notConfigured(): never {
  throw new Error('Cổng AI chưa được cấu hình bản cài đặt (AI_GATEWAY_DRIVER)');
}

@Module({})
export class AiGatewayModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: AiGatewayModule,
      providers: [
        {
          // Sự kiện 80/100% tạo TRONG giao dịch quyết toán (nguyên tắc IV, research R7) – không bao giờ
          // emit sau khi settle đã trả.
          provide: AI_ON_CROSSED,
          inject: [NOTIFICATIONS],
          useFactory: (notifications: NotificationsPublicApi): OnCrossed => makeOnCrossed(notifications),
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
          inject: [APP_CONFIG, AI_FAKE_BUNDLE, AI_ON_CROSSED],
          useFactory: (
            config: AppConfig,
            bundle: FakeAiBundle | null,
            onCrossed: OnCrossed | undefined,
          ): AiGatewayPublicApi => {
            if (bundle === null) {
              return new Proxy({}, { get: () => notConfigured }) as AiGatewayPublicApi;
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
