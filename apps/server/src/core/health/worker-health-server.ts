import { createServer, type Server } from 'node:http';
import type { HealthResponse } from '@app/shared/core';
import type { LifecycleState } from '../lifecycle/shutdown-coordinator';

export interface WorkerHealthServerOptions {
  version: string;
  getState: () => LifecycleState;
}

/**
 * Cổng kiểm tra sống của Worker: máy chủ `node:http` thuần, chỉ phục vụ `GET /healthz`.
 * KHÔNG dùng NestJS router – Worker không bao giờ có endpoint nghiệp vụ (FR-004, R5).
 */
export class WorkerHealthServer {
  private readonly server: Server;

  constructor(private readonly options: WorkerHealthServerOptions) {
    this.server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'GET' || path !== '/healthz') {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'not_found' }));
        return;
      }
      const state = this.options.getState();
      if (state === 'stopping' || state === 'stopped') {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'stopping' }));
        return;
      }
      const body: HealthResponse = {
        status: 'ok',
        unit: 'worker',
        version: this.options.version,
        time: new Date().toISOString(),
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    });
    // Không giữ kết nối keep-alive khi tắt.
    this.server.keepAliveTimeout = 1000;
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
