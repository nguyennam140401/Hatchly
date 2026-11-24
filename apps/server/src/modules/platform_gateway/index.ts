// Giao diện công khai DUY NHẤT của module Cổng nền tảng (005, contracts/platform-gateway.md mục 1).
export { PlatformGatewayModule } from './platform_gateway.module';
export * from './public-api';
export { registerConnectionConsumers } from './internal/connections/consumers';
export { validateMedia } from './internal/adapters/media-rules';
export { applyErrorMapping } from './internal/adapters/classify';
export {
  ChannelNotSupportedError,
  ConnectionNotFoundError,
  InvalidRequestError,
} from './internal/errors';
// CHỈ development/test – tầng ghép (app/, dev/) dùng: trang ủy quyền giả, kho + API lập trình giả lập.
export {
  FakeOauthController,
  fakePlatform,
  getFakePlatformStore,
  PlatformScenarioSpec,
  type FakePlatformControl,
} from './internal/fake';
