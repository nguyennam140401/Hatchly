// Giao diện công khai DUY NHẤT của module Cổng AI (005, contracts/ai-gateway.md mục 1).
export { AiGatewayModule, AI_FAKE_BUNDLE } from './ai_gateway.module';
export * from './public-api';
export { noRetryOnAiError } from './jobs';
export { AiError, type AiErrorCode } from './internal/errors';
// CHỈ development/test – tầng ghép (dev/) dùng: kho + API lập trình của bản giả lập.
export { fakeAi, FakeAiStep, type FakeAiBundle, type FakeBudgetView } from './internal/fake';
