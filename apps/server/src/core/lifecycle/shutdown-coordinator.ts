import type { BeforeApplicationShutdown } from '@nestjs/common';

export type LifecycleState = 'starting' | 'ready' | 'stopping' | 'stopped';

export interface ShutdownCoordinatorOptions {
  /** Thời gian chờ tối đa các tác vụ đang chạy (SHUTDOWN_TIMEOUT_MS). */
  timeoutMs: number;
  /** Hàm thoát tiến trình – tiêm được để kiểm thử. */
  exit: (code: number) => void;
  logger: { log: (message: unknown) => void; warn: (message: unknown) => void };
}

type StoppingListener = () => void | Promise<void>;

/**
 * Điều phối tắt có kiểm soát (R5, nguyên tắc V):
 * 1. chuyển `stopping` → bộ tiêu thụ hàng chờ (WBS 1.3) ngừng lấy việc qua `onStopping()`;
 * 2. chờ các tác vụ đã đăng ký bằng `trackInFlight()`;
 * 3. quá `timeoutMs` → ghi cảnh báo và thoát mã 1.
 */
export class ShutdownCoordinator implements BeforeApplicationShutdown {
  private current: LifecycleState = 'starting';
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly listeners: StoppingListener[] = [];
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly options: ShutdownCoordinatorOptions) {}

  get state(): LifecycleState {
    return this.current;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get isAcceptingWork(): boolean {
    return this.current === 'ready';
  }

  markReady(): void {
    if (this.current === 'starting') this.current = 'ready';
  }

  /** Điểm móc cho pg-boss `stop({ graceful })` ở WBS 1.3. */
  onStopping(listener: StoppingListener): void {
    this.listeners.push(listener);
  }

  /** Đăng ký một tác vụ đang chạy; tiến trình chỉ dừng khi tác vụ xong (hoặc hết hạn chờ). */
  trackInFlight<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise.finally(() => this.inFlight.delete(tracked));
    // Tác vụ lỗi vẫn tính là xong; lỗi trả về cho người gọi qua `tracked`.
    tracked.catch(() => undefined);
    this.inFlight.add(tracked);
    return tracked;
  }

  beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shutdownPromise ??= this.drain(signal);
    return this.shutdownPromise;
  }

  private async drain(signal: string | undefined): Promise<void> {
    this.current = 'stopping';
    for (const listener of this.listeners) await listener();

    const pending = [...this.inFlight];
    if (pending.length > 0) {
      this.options.logger.log({ msg: 'shutdown.waiting', in_flight: pending.length, signal });
    }

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, this.options.timeoutMs);
    });
    const outcome = await Promise.race([
      Promise.allSettled(pending).then(() => 'done' as const),
      timedOut,
    ]);
    clearTimeout(timer);

    if (outcome === 'timeout') {
      this.options.logger.warn({
        msg: 'shutdown.timeout',
        in_flight: this.inFlight.size,
        timeout_ms: this.options.timeoutMs,
      });
      this.options.exit(1);
      return;
    }
    this.current = 'stopped';
  }
}
