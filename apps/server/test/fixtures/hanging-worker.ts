// Worker có một tác vụ không bao giờ xong – dùng cho kiểm thử hết hạn chờ khi tắt (shutdown.spec.ts).
import { bootstrapWorker } from '../../src/worker';

void bootstrapWorker().then(({ coordinator }) => {
  void coordinator.trackInFlight(new Promise<void>(() => undefined));
});
