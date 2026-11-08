import type { INestApplicationContext, LoggerService } from '@nestjs/common';

export interface ShutdownSignalOptions {
  logger: LoggerService;
  /** Tên sự kiện nhật ký, vd `worker` → `worker.stopping` / `worker.stopped`. */
  unit: 'api' | 'worker';
  /** Gọi sau khi đóng xong (vd đóng cổng kiểm tra sống của Worker). */
  afterClose?: () => Promise<void>;
  exit?: (code: number) => void;
}

/**
 * Bắt SIGTERM/SIGINT và đóng ứng dụng có kiểm soát (gọi các hook `beforeApplicationShutdown` –
 * trong đó có ShutdownCoordinator chờ việc đang chạy ≤ SHUTDOWN_TIMEOUT_MS).
 *
 * Không dùng `app.enableShutdownHooks()` của NestJS vì sau khi đóng nó gửi lại tín hiệu cho chính
 * tiến trình (`process.kill(pid, signal)`), làm tiến trình kết thúc do tín hiệu thay vì mã 0
 * như yêu cầu của SC-004.
 */
export function installShutdownSignals(
  app: INestApplicationContext,
  options: ShutdownSignalOptions,
): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let closing = false;

  const handler = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    options.logger.log({ msg: `${options.unit}.stopping`, signal });
    void (async () => {
      try {
        await app.close();
        await options.afterClose?.();
        options.logger.log({ msg: `${options.unit}.stopped`, signal });
        exit(0);
      } catch (err) {
        options.logger.error({ msg: `${options.unit}.stop_failed`, err });
        exit(1);
      }
    })();
  };

  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}
