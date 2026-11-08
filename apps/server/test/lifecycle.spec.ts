import { describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator } from '../src/core/lifecycle/shutdown-coordinator';

const silentLogger = { log: vi.fn(), warn: vi.fn() };

function makeCoordinator(timeoutMs = 1000) {
  const exit = vi.fn();
  const coordinator = new ShutdownCoordinator({ timeoutMs, exit, logger: silentLogger });
  return { coordinator, exit };
}

describe('ShutdownCoordinator', () => {
  it('trạng thái đi starting → ready → stopping → stopped', async () => {
    const { coordinator } = makeCoordinator();
    const seen: string[] = [coordinator.state];
    coordinator.onStopping(() => {
      seen.push(coordinator.state);
    });
    coordinator.markReady();
    seen.push(coordinator.state);
    await coordinator.beforeApplicationShutdown('SIGTERM');
    seen.push(coordinator.state);
    expect(seen).toEqual(['starting', 'ready', 'stopping', 'stopped']);
  });

  it('trackInFlight() trì hoãn dừng tới khi tác vụ xong', async () => {
    const { coordinator, exit } = makeCoordinator(5000);
    coordinator.markReady();
    let finish!: () => void;
    const task = new Promise<void>((resolve) => (finish = resolve));
    void coordinator.trackInFlight(task);
    expect(coordinator.inFlightCount).toBe(1);

    let stopped = false;
    const shutdown = coordinator.beforeApplicationShutdown('SIGTERM').then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped).toBe(false);
    expect(coordinator.state).toBe('stopping');

    finish();
    await shutdown;
    expect(stopped).toBe(true);
    expect(coordinator.state).toBe('stopped');
    expect(exit).not.toHaveBeenCalled();
  });

  it('tác vụ lỗi vẫn được coi là xong', async () => {
    const { coordinator, exit } = makeCoordinator();
    const failing = coordinator.trackInFlight(Promise.reject(new Error('lỗi')));
    await expect(failing).rejects.toThrow('lỗi');
    await coordinator.beforeApplicationShutdown();
    expect(coordinator.state).toBe('stopped');
    expect(exit).not.toHaveBeenCalled();
  });

  it('quá SHUTDOWN_TIMEOUT_MS → thoát cưỡng bức mã 1', async () => {
    vi.useFakeTimers();
    try {
      const { coordinator, exit } = makeCoordinator(1000);
      coordinator.markReady();
      void coordinator.trackInFlight(new Promise<void>(() => undefined));
      const shutdown = coordinator.beforeApplicationShutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);
      await shutdown;
      expect(exit).toHaveBeenCalledWith(1);
      expect(silentLogger.warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gọi dừng hai lần chỉ chạy một lần', async () => {
    const { coordinator } = makeCoordinator();
    const listener = vi.fn();
    coordinator.onStopping(listener);
    await Promise.all([
      coordinator.beforeApplicationShutdown(),
      coordinator.beforeApplicationShutdown(),
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
