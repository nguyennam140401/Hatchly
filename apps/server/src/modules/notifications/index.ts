// Giao diện công khai DUY NHẤT của module Thông báo (005, contracts/notifications.md mục 2).
export { NotificationsModule, NOTIFICATION_STORE } from './notifications.module';
export { NOTIFICATIONS, type NotificationsPublicApi, type NotificationEvent, type NotificationType } from './public-api';
export { NotificationEventInvalidError } from './internal/forbidden';
// CHỈ development/test – tầng ghép (dev/) dùng: API lập trình của bản giả lập.
export { fakeNotify, type FakeNotifyControl } from './internal/fake';
export type { DeliveredNotification } from './internal/store';
