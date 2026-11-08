import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Vitest luôn chạy với thư mục làm việc là gói apps/server.
export const SERVER_DIR = resolve(process.cwd());

export interface RunningProcess {
  child: ChildProcess;
  /** Các dòng nhật ký JSON đã đọc được từ stdout. */
  logs: Record<string, unknown>[];
  /** Chờ tới khi có dòng nhật ký có `msg` khớp. */
  waitForLog: (msg: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
  /** Chờ tiến trình thoát, trả mã thoát và thời gian từ lúc gọi. */
  waitForExit: (timeoutMs?: number) => Promise<{ code: number | null; signal: string | null }>;
}

/** Chạy một tiến trình Node (vd `dist/worker.js`) với biến môi trường cho trước. */
export function startNode(args: string[], env: Record<string, string>): RunningProcess {
  const child = spawn(process.execPath, args, {
    cwd: SERVER_DIR,
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: Record<string, unknown>[] = [];
  const waiters: { msg: string; resolve: (l: Record<string, unknown>) => void }[] = [];
  let buffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        logs.push(parsed);
        for (const w of waiters.filter((x) => x.msg === parsed.msg)) w.resolve(parsed);
      } catch {
        // bỏ qua dòng không phải JSON
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));

  const exited = new Promise<{ code: number | null; signal: string | null }>((res) => {
    child.on('exit', (code, signal) => {
      res({ code, signal });
    });
  });

  return {
    child,
    logs,
    waitForLog: (msg, timeoutMs = 20_000) => {
      const found = logs.find((l) => l.msg === msg);
      if (found) return Promise.resolve(found);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`Không thấy nhật ký "${msg}" sau ${timeoutMs} ms. stderr: ${stderr}`));
        }, timeoutMs);
        waiters.push({
          msg,
          resolve: (l) => {
            clearTimeout(timer);
            res(l);
          },
        });
        void exited.then(({ code }) => {
          clearTimeout(timer);
          rej(new Error(`Tiến trình thoát (mã ${code}) trước khi có "${msg}". stderr: ${stderr}`));
        });
      });
    },
    waitForExit: (timeoutMs = 40_000) =>
      Promise.race([
        exited,
        new Promise<never>((_, rej) =>
          setTimeout(() => {
            rej(new Error(`Tiến trình không thoát sau ${timeoutMs} ms`));
          }, timeoutMs),
        ),
      ]),
  };
}

/** Gọi HTTP GET, trả mã trạng thái và thân JSON (hoặc lỗi kết nối). */
export async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
}

/** Thử lại GET tới khi nhận được phản hồi (dịch vụ đã mở cổng). */
export async function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
