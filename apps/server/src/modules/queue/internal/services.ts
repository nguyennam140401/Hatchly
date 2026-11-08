// Dịch vụ nhịp chạy cùng QueueRuntime ở Worker (US5): bộ xử lý việc nội bộ + bộ hẹn giờ việc định kỳ.
import type { AppConfig } from '../../../core';
import '../jobs';
import { InternalJobsService } from './maintenance';
import type { RuntimeService } from './runtime/queue-runtime';
import { SchedulerService } from './scheduler/scheduler';

export function queueServices(options: {
  appEnv: AppConfig['APP_ENV'];
  schedulerTickMs: number;
}): RuntimeService[] {
  return [
    new InternalJobsService(),
    new SchedulerService({ tickMs: options.schedulerTickMs, appEnv: options.appEnv }),
  ];
}
