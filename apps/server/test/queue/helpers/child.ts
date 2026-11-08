// Điều khiển tiến trình con worker-child.ts từ kiểm thử.
import { type ChildProcess, fork } from 'node:child_process';
import { join } from 'node:path';
import { dbUrls } from '../../db/helpers/db';

export interface ChildMessage {
  event: string;
  [key: string]: unknown;
}

export interface WorkerChild {
  child: ChildProcess;
  messages: ChildMessage[];
  waitFor(event: string, timeoutMs?: number, match?: (m: ChildMessage) => boolean): Promise<ChildMessage>;
  exited: Promise<{ code: number | null; signal: string | null; at: number }>;
  stop(): void;
  kill(): void;
}

export function startWorkerChild(env: Record<string, string> = {}): WorkerChild {
  const child = fork(join(__dirname, 'worker-child.ts'), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      PATH: process.env.PATH ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
      APP_ENV: 'test',
      DATABASE_APP_URL: dbUrls.app,
      DATABASE_SYSTEM_URL: dbUrls.system,
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: ChildMessage[] = [];
  const waiters: { event: string; match: (m: ChildMessage) => boolean; resolve: (m: ChildMessage) => void }[] = [];
  child.on('message', (raw) => {
    const m = raw as ChildMessage;
    messages.push(m);
    for (const w of [...waiters]) {
      if (w.event === m.event && w.match(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (c: string) => (stderr += c));
  const exited = new Promise<{ code: number | null; signal: string | null; at: number }>((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ code, signal, at: Date.now() });
    });
  });
  return {
    child,
    messages,
    exited,
    waitFor: (event, timeoutMs = 30_000, match = () => true) => {
      const found = messages.find((m) => m.event === event && match(m));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Tiến trình con: hết thời gian chờ ${event}. stderr: ${stderr.slice(-2000)}`));
        }, timeoutMs);
        waiters.push({
          event,
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    stop: () => {
      child.send({ cmd: 'stop' });
    },
    kill: () => {
      child.kill('SIGKILL');
    },
  };
}
