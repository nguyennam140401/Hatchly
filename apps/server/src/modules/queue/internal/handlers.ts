// Sổ bộ xử lý việc trong tiến trình (contracts/queue-api.md mục 4, FR-003). Chỉ Worker đăng ký được.
import { getJobType } from '../job-types';
import type { JobHandler, JobHandlerOptions, JobTypeDefinition } from '../public-api';
import { queueError } from './errors';

export interface RegisteredHandler {
  def: JobTypeDefinition<unknown>;
  handler: JobHandler<unknown>;
  onFinalFailure: JobHandlerOptions<unknown>['onFinalFailure'];
}

let unit: 'api' | 'worker' | undefined;
const handlers = new Map<string, RegisteredHandler>();

/** Đơn vị triển khai của tiến trình (QueueModule đặt khi khởi tạo). */
export function setQueueUnit(value: 'api' | 'worker' | undefined): void {
  unit = value;
}

export function queueUnit(): 'api' | 'worker' | undefined {
  return unit;
}

/** Đăng ký bộ xử lý cho một loại việc. Gọi ở API → `QUEUE_HANDLER_ON_API`; đăng ký hai lần → ném. */
export function registerJobHandler<P>(
  def: JobTypeDefinition<P>,
  handler: JobHandler<P>,
  opts: JobHandlerOptions<P> = {},
): void {
  if (unit === 'api') throw queueError('QUEUE_HANDLER_ON_API');
  if (getJobType(def.name) !== (def as JobTypeDefinition<unknown>)) {
    throw queueError('QUEUE_JOB_TYPE_UNKNOWN');
  }
  if (handlers.has(def.name)) throw new Error(`Loại việc ${def.name} đã có bộ xử lý`);
  handlers.set(def.name, {
    def: def as JobTypeDefinition<unknown>,
    handler: handler as JobHandler<unknown>,
    onFinalFailure: opts.onFinalFailure as JobHandlerOptions<unknown>['onFinalFailure'],
  });
}

export function getHandler(name: string): RegisteredHandler | undefined {
  return handlers.get(name);
}

/** CHỈ kiểm thử: gỡ bộ xử lý giữa các ca. */
export function unregisterJobHandler(name: string): void {
  handlers.delete(name);
}
