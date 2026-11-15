import { describe } from 'vitest';
import {
  FacebookIdentityProvider,
  GoogleIdentityProvider,
} from '../../../src/modules/account/internal/auth/oauth/arctic.providers';
import { describeIdentityProviderContract } from './identity-provider.contract';

// T019 (009): bản THẬT (arctic) – chỉ chạy khi có khóa thử trong biến môi trường (như 005). Không có
// người bấm đồng ý nên chỉ kiểm địa chỉ ủy quyền và việc nhà cung cấp từ chối mã sai (gọi mạng thật).

const env = process.env;
const REDIRECT = env.IDENTITY_SANDBOX_REDIRECT_BASE ?? 'http://localhost:8080';
const google =
  env.IDENTITY_SANDBOX_GOOGLE_CLIENT_ID !== undefined &&
  env.IDENTITY_SANDBOX_GOOGLE_CLIENT_SECRET !== undefined
    ? {
        clientId: env.IDENTITY_SANDBOX_GOOGLE_CLIENT_ID,
        clientSecret: env.IDENTITY_SANDBOX_GOOGLE_CLIENT_SECRET,
      }
    : null;
const facebook =
  env.IDENTITY_SANDBOX_FACEBOOK_APP_ID !== undefined &&
  env.IDENTITY_SANDBOX_FACEBOOK_APP_SECRET !== undefined
    ? {
        appId: env.IDENTITY_SANDBOX_FACEBOOK_APP_ID,
        appSecret: env.IDENTITY_SANDBOX_FACEBOOK_APP_SECRET,
      }
    : null;

describe.skipIf(google === null)('Google (thật)', () => {
  describeIdentityProviderContract(() => {
    if (google === null) throw new Error('thiếu khóa Google thử');
    return {
      provider: new GoogleIdentityProvider({
        ...google,
        redirectUri: `${REDIRECT}/api/v1/auth/oauth/google/callback`,
      }),
      appSecret: google.clientSecret,
      rejectedCode: 'ma-sai-co-chu-dich',
    };
  });
});

describe.skipIf(facebook === null)('Facebook (thật)', () => {
  describeIdentityProviderContract(() => {
    if (facebook === null) throw new Error('thiếu khóa Facebook thử');
    return {
      provider: new FacebookIdentityProvider({
        ...facebook,
        redirectUri: `${REDIRECT}/api/v1/auth/oauth/facebook/callback`,
        graphVersion: env.FACEBOOK_GRAPH_VERSION ?? 'v21.0',
      }),
      appSecret: facebook.appSecret,
      rejectedCode: 'ma-sai-co-chu-dich',
    };
  });
});
