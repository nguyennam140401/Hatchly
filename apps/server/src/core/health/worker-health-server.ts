import { createServer, type Server, type ServerResponse } from 'node:http';
import type { HealthResponse } from '@app/shared/core';
import type { LifecycleState } from '../lifecycle/shutdown-coordinator';

export interface WorkerHealthServerOptions {
  version: string;
  getState: () => LifecycleState;
  /** Kiểm tra sẵn sàng (ReadinessRegistry): CSDL, hàng chờ – cho `GET /readyz` (003 FR-019). */
  readiness?: { run(): Promise<{ name: string; status: 'pass' | 'fail' }[]> };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Cổng kiểm tra của Worker: máy chủ `node:http` thuần, chỉ phục vụ `GET /healthz` (sống) và
 * `GET /readyz` (sẵn sàng – contracts/queue-commands.md mục 3). KHÔNG dùng NestJS router – Worker không
 * bao giờ có endpoint nghiệp vụ (FR-004, R5).
 */
export class WorkerHealthServer {
  private readonly server: Server;

  constructor(private readonly options: WorkerHealthServerOptions) {
    this.server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'GET' || (path !== '/healthz' && path !== '/readyz')) {
        send(res, 404, { status: 'not_found' });
        return;
      }
      const state = this.options.getState();
      if (state === 'stopping' || state === 'stopped') {
        send(res, 503, { status: 'stopping' });
        return;
      }
      if (path === '/readyz') {
        void this.ready(res);
        return;
      }
      const body: HealthResponse = {
        status: 'ok',
        unit: 'worker',
        version: this.options.version,
        time: new Date().toISOString(),
      };
      send(res, 200, body);
    });
    // Không giữ kết nối keep-alive khi tắt.
    this.server.keepAliveTimeout = 1000;
  }

  private async ready(res: ServerResponse): Promise<void> {
    const checks = (await this.options.readiness?.run()) ?? [];
    const failed = checks.some((c) => c.status === 'fail');
    send(res, failed ? 503 : 200, { status: failed ? 'not_ready' : 'ready', checks });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  /** Cổng thực đang nghe (kiểm thử dùng cổng 0). */
  get port(): number {
    const address = this.server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }
}
