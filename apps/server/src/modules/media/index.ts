// Giao diện công khai DUY NHẤT của module Thư viện media. KHÔNG xuất `internal/`, `jobs.ts`.
export { MediaModule } from './media.module';
export {
  MEDIA_PUBLIC_API,
  type AttachResult,
  type DescribeResult,
  type MediaPublicApi,
  type MediaSummary,
  type PublicUrlResult,
  type PublishableMedia,
  type PublishableMediaResult,
} from './public-api';
export {
  registerMediaUsageProvider,
  type MediaUsageProvider,
  type MediaUsageRef,
} from './internal/usage-registry';
