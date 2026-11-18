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

// ----- Kịch bản kết nối kênh (010): OAuth, me/accounts, debug_token, me/permissions, thu hồi quyền -----

export interface StubPage {
  id: string;
  name: string;
  /** Mã Page (bí mật giả) – phải KHÔNG lọt vào log/phản hồi (kiểm bởi secret-scan). */
  accessToken: string;
  tasks?: string[];
  instagram?: { id: string; username: string };
}

/** Một trang kết quả `me/accounts` có thể kèm con trỏ trang kế (`paging.next`). */
export function accountsPage(pages: StubPage[], next?: string): StubReply {
  return {
    json: {
      data: pages.map((p) => ({
        id: p.id,
        name: p.name,
        picture: { data: { url: `https://cdn.example.test/${p.id}.jpg` } },
        access_token: p.accessToken,
        tasks: p.tasks ?? ['CREATE_CONTENT', 'MANAGE'],
        ...(p.instagram === undefined
          ? {}
          : { instagram_business_account: { id: p.instagram.id, username: p.instagram.username } }),
      })),
      ...(next === undefined ? {} : { paging: { next } }),
    },
  };
}

export interface MetaConnectScenario {
  pages: StubPage[];
  /** Quyền người dùng đã cấp (mặc định đủ). */
  grantedScopes?: string[];
  /** Hạn mã (epoch giây); 0 = không hạn (Meta trả 0 cho mã không hết hạn). */
  expiresAt?: number;
  dataAccessExpiresAt?: number;
}

export const DEFAULT_GRANTED_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
];

/** Nạp kịch bản chuẩn: đổi mã → mã ngắn hạn → dài hạn, danh sách Page, `debug_token`, quyền. */
export function loadMetaConnectScenario(stub: GraphStub, s: MetaConnectScenario): void {
  stub.on('GET /oauth/access_token', {
    json: { access_token: 'EAAshort_user_token', expires_in: 3600 },
  });
  stub.on('GET /oauth/access_token', {
    json: { access_token: 'EAAlong_user_token', token_type: 'bearer', expires_in: 5_184_000 },
  });
  stub.on('GET /me/accounts', accountsPage(s.pages));
  stub.on('GET /debug_token', {
    json: {
      data: {
        is_valid: true,
        expires_at: s.expiresAt ?? 0,
        data_access_expires_at: s.dataAccessExpiresAt ?? 0,
        scopes: s.grantedScopes ?? DEFAULT_GRANTED_SCOPES,
      },
    },
  });
  stub.on('GET /me/permissions', {
    json: {
      data: (s.grantedScopes ?? DEFAULT_GRANTED_SCOPES).map((permission) => ({
        permission,
        status: 'granted',
      })),
    },
  });
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
