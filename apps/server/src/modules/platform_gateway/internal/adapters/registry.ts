import type { ChannelType } from '../../public-api';
import { ChannelNotSupportedError } from '../errors';
import type { PlatformAdapter } from './adapter';

// Danh mục bộ chuyển đổi theo loại kênh (005, R2, SC-002). Đây là tệp ghép DUY NHẤT nơi đăng ký bộ
// chuyển đổi: thêm nền tảng = thêm bộ chuyển đổi + một dòng trong `registerDefaultAdapters`.

const factories = new Map<ChannelType, () => PlatformAdapter>();
const instances = new Map<ChannelType, PlatformAdapter>();

export function registerAdapter(type: ChannelType, make: () => PlatformAdapter): void {
  factories.set(type, make);
  instances.delete(type);
}

/** Bộ chuyển đổi của loại kênh; chưa đăng ký → ChannelNotSupportedError (không hành vi mặc định ngầm). */
export function getAdapter(type: ChannelType): PlatformAdapter {
  let adapter = instances.get(type);
  if (adapter === undefined) {
    const make = factories.get(type);
    if (make === undefined) throw new ChannelNotSupportedError();
    adapter = make();
    instances.set(type, adapter);
  }
  return adapter;
}

export function listRegisteredAdapters(): PlatformAdapter[] {
  return [...factories.keys()].map((type) => getAdapter(type));
}

/** CHỈ kiểm thử: gỡ mọi đăng ký. */
export function clearAdapters(): void {
  factories.clear();
  instances.clear();
}

export interface DefaultAdapterOptions {
  driver: 'fake' | undefined;
  appEnv: 'development' | 'test' | 'staging' | 'production';
  /** Dựng bộ chuyển đổi giả cho một loại kênh (do module ghép tiêm vào – kho trạng thái đã chọn). */
  makeFake: (type: ChannelType) => PlatformAdapter;
}

/** Đăng ký bộ chuyển đổi theo cấu hình. Bản giả lập CHỈ ở development/test. */
export function registerDefaultAdapters(opts: DefaultAdapterOptions): void {
  const devLike = opts.appEnv === 'development' || opts.appEnv === 'test';
  if (opts.driver !== 'fake' || !devLike) return;
  registerAdapter('facebook_page', () => opts.makeFake('facebook_page'));
  registerAdapter('instagram', () => opts.makeFake('instagram'));
  registerAdapter('zalo_oa', () => opts.makeFake('zalo_oa'));
  registerAdapter('test_channel', () => opts.makeFake('test_channel'));
}
