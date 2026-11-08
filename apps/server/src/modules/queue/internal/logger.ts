// Nhật ký có cấu trúc của lớp hàng chờ (contracts/queue-observability.md mục 2). Mỗi dòng là một đối
// tượng có `event`; KHÔNG BAO GIỜ chứa payload đầy đủ, chuỗi kết nối hay bí mật (SC-011).

export type QueueLogEntry = Record<string, unknown> & { event: string };

export interface QueueLogger {
  debug(entry: QueueLogEntry): void;
  info(entry: QueueLogEntry): void;
  warn(entry: QueueLogEntry): void;
  error(entry: QueueLogEntry): void;
}

export const silentLogger: QueueLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Bộ chuyển nhật ký sang Logger của NestJS (nestjs-pino ghi đối tượng thành trường JSON). */
export function nestQueueLogger(logger: {
  debug?: (message: unknown) => void;
  log: (message: unknown) => void;
  warn: (message: unknown) => void;
  error: (message: unknown) => void;
}): QueueLogger {
  return {
    debug: (e) => logger.debug?.({ msg: e.event, ...e }),
    info: (e) => logger.log({ msg: e.event, ...e }),
    warn: (e) => logger.warn({ msg: e.event, ...e }),
    error: (e) => logger.error({ msg: e.event, ...e }),
  };
}
