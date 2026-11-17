// Kiểu dùng chung của bộ thực thi 5 bước (013). Bộ thực thi chỉ nói chuyện với module khác qua giao diện công khai
// (Hiến pháp IV); mọi phụ thuộc được tiêm qua `ExecutorDeps` để kiểm thử bằng bản giả.
import type { AccountPublicApi } from '../../../account';
import type { ContentPublicApi } from '../../../content';
import type { MediaPublicApi } from '../../../media';
import type { NotificationsPublicApi } from '../../../notifications';
import type { PlatformGatewayPublicApi } from '../../../platform_gateway';
import type { JobHandlerResult } from '../../../queue';
import type { PublishAttemptRow } from '../db/schema';
import type { ErrorMappingService } from '../error-mapping.service';
import type { PublishSettings } from '../retry-policy';
import type { StepContext } from '../step-log';

export interface ExecutorDeps {
  /** `none` → hoãn việc, không đổi trạng thái (an toàn khi chưa bật đăng thật). `run`/`fake` → chạy 5 bước. */
  mode: 'none' | 'run' | 'fake';
  content: ContentPublicApi;
  gateway: PlatformGatewayPublicApi;
  /** Chỉ cần bước 2 "chuẩn bị media" (013) – thu hẹp để bản giả trong kiểm thử không phải cài cả giao diện. */
  media: Pick<MediaPublicApi, 'getPublishableMedia'>;
  account: AccountPublicApi;
  notifications: NotificationsPublicApi;
  errorMapping: ErrorMappingService;
  settings: PublishSettings;
  /** Đồng hồ ứng dụng (kiểm thử đặt giờ giả); quyết định "quá giờ hẹn" dùng giờ CSDL. */
  now: () => Date;
}

/** Ngữ cảnh một lần chạy của bộ xử lý. `attempt` luôn là ảnh chụp MỚI NHẤT mà bộ xử lý biết. */
export interface RunContext {
  attempt: PublishAttemptRow;
  step: StepContext;
  signal: AbortSignal;
  /** Lượt vừa chuyển từ `scheduled` (áp quy tắc quá giờ hẹn, R7). */
  startedFromScheduled: boolean;
}

/** Kết quả của một bước: tiếp tục, hoặc dừng với kết quả cho hàng chờ (trạng thái đã ghi xong). */
export type Flow<T = undefined> =
  { kind: 'continue'; value: T } | { kind: 'stop'; result: JobHandlerResult };

export const cont = <T>(value: T): Flow<T> => ({ kind: 'continue', value });
export const stop = (result?: JobHandlerResult): Flow<never> => ({
  kind: 'stop',
  result,
});
