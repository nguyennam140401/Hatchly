import { type DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, MAILER, MailModule, type AppConfig, type Mailer } from '../../core';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../account';
import { registerJobHandler } from '../queue';
import { deliverNotification } from './internal/deliver.handler';
import { QueueEmitter } from './internal/emit';
import { getMemoryEmitter, getNotificationStore } from './internal/fake';
import type { NotificationStore } from './internal/store';
import { notifyDeliverJob } from './jobs';
import { NOTIFICATIONS, type NotificationsPublicApi } from './public-api';

// Module Thông báo (005). `NOTIFICATIONS_DRIVER` (hiện chỉ `fake` – bản thật WBS 4.3); `FAKE_STATE_STORE`:
// `sandbox` → `emit` thật (hàng chờ `notify`) + kho ntf_fake_*; `memory` → bộ phát bộ nhớ + kho bộ nhớ.
// Worker: bộ xử lý `notifications.deliver`. Global để module khác (ai_gateway…) tiêm `NOTIFICATIONS`
// – ranh giới vẫn do manifest + dependency-cruiser kiểm.

export const NOTIFICATION_STORE = Symbol('NOTIFICATION_STORE');

let handlerRegistered = false;

@Module({})
export class NotificationsModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: NotificationsModule,
      global: true,
      imports: [MailModule],
      providers: [
        {
          provide: NOTIFICATION_STORE,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig): Promise<NotificationStore> | null =>
            config.NOTIFICATIONS_DRIVER === 'fake'
              ? getNotificationStore(config.FAKE_STATE_STORE ?? 'memory')
              : null,
        },
        {
          provide: NOTIFICATIONS,
          inject: [APP_CONFIG, NOTIFICATION_STORE, ACCOUNT_PUBLIC_API, MAILER],
          useFactory: (
            config: AppConfig,
            store: NotificationStore | null,
            accounts: AccountPublicApi,
            mailer: Mailer,
          ): NotificationsPublicApi => {
            if (store === null) {
              return {
                emit: () => Promise.reject(new Error('Thông báo chưa được cấu hình (NOTIFICATIONS_DRIVER)')),
              };
            }
            if (unit === 'worker' && !handlerRegistered) {
              handlerRegistered = true;
              registerJobHandler(notifyDeliverJob, async ({ event }) => {
                await deliverNotification(event, {
                  store,
                  members: accounts,
                  mailer,
                  webBaseUrl: config.WEB_BASE_URL ?? 'http://localhost:8080',
                });
              });
            }
            return config.FAKE_STATE_STORE === 'sandbox' ? new QueueEmitter() : getMemoryEmitter();
          },
        },
      ],
      exports: [NOTIFICATIONS, NOTIFICATION_STORE],
    };
  }
}
