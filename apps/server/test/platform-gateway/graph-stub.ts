// Máy chủ Graph giả cục bộ cho kiểm thử hợp đồng bộ chuyển đổi Meta (013 T066). Kịch bản theo "đường dẫn kết thúc bằng":
// mỗi kịch bản trả JSON, mã HTTP, độ trễ hoặc cắt kết nối. Ghi lại mọi yêu cầu để kiểm "mã quyền chỉ ở tiêu đề".
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubReply {
  status?: number;
  json?: unknown;
  /** Chờ rồi mới trả (mô phỏng nền tảng chậm → hết thời gian SAU khi đã nhận yêu cầu). */
  delayMs?: number;
  /** Đóng kết nối ngay sau khi nhận yêu cầu (mất kết nối sau khi gửi). */
  destroy?: boolean;
  headers?: Record<string, string>;
}

export interface StubRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export class GraphStub {
  private server: Server | undefined;
  readonly requests: StubRequest[] = [];
  /** Hàng đợi trả lời theo `METHOD suffix` (vd `POST /feed`); hết thì dùng `fallback`. */
  private readonly replies = new Map<string, StubReply[]>();
  fallback: StubReply = { status: 200, json: { id: 'stub-1' } };

  on(route: string, ...replies: StubReply[]): this {
    this.replies.set(route, [...(this.replies.get(route) ?? []), ...replies]);
    return this;
  }

  clear(): void {
    this.requests.length = 0;
    this.replies.clear();
    this.fallback = { status: 200, json: { id: 'stub-1' } };
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((r) => this.server?.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => {
      this.server?.closeAllConnections();
      this.server?.close(() => {
        r();
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = (req.url ?? '').split('?')[0] ?? '';
    this.requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const key = [...this.replies.keys()].find((k) => {
      const [m, suffix] = k.split(' ');
      return m === req.method && path.endsWith(suffix ?? '');
    });
    const queue = key === undefined ? undefined : this.replies.get(key);
    const reply = queue !== undefined && queue.length > 0 ? queue.shift()! : this.fallback;
    if (reply.destroy === true) {
      req.socket.destroy();
      return;
    }
    if (reply.delayMs !== undefined) await new Promise((r) => setTimeout(r, reply.delayMs));
    if (res.destroyed) return;
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
    res.end(JSON.stringify(reply.json ?? {}));
  }
}

export const graphError = (code: number, subcode?: number, status = 400): StubReply => ({
  status,
  json: {
    error: {
      code,
      ...(subcode !== undefined ? { error_subcode: subcode } : {}),
      message: 'secret-should-not-leak',
    },
  },
});
