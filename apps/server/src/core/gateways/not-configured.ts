// Giá trị thế chỗ khi một cổng CHƯA chọn bản cài đặt (chỉ xảy ra khi dựng app bỏ qua `loadConfig`, vd
// kiểm thử production trước khi có bản thật – 005). Mọi thao tác ném lỗi nêu tên biến; các khóa mà NestJS
// /Promise dò (hàm vòng đời, `then`) trả `undefined` để việc dựng app không gọi nhầm.

const IGNORED = new Set<string | symbol>([
  'then',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
  'constructor',
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
]);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T chỉ để bên gọi nêu kiểu thế chỗ
export function notConfiguredProxy<T>(variable: string, label: string): T {
  const fail = () => {
    throw new Error(`${label} chưa được cấu hình bản cài đặt (${variable})`);
  };
  return new Proxy(
    {},
    {
      get: (_t, key) => (IGNORED.has(key) ? undefined : fail),
    },
  ) as T;
}
