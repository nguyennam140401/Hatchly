import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AUTH_CONFIG, Public, ValidQuery, type AuthConfig } from '../../../../../core';
import {
  encodeFakeCode,
  FAKE_AUTHORIZE_PATH,
  FAKE_SCENARIOS,
  scenarioFits,
  type FakeScenario,
} from './fake.provider';
import { PROVIDER_LABELS, PROVIDER_NAMES } from './identity-provider';

// Trang ủy quyền GIẢ của Google/Facebook (009, contracts/module-api.md mục 6). CHỈ được đăng ký khi
// OAUTH_DRIVER=fake (development/test) – staging/production không có route này (→ 404). Chỉ chuyển về
// đường quay lại của chính ứng dụng (chống chuyển hướng mở).

const query = z.object({
  provider: z.enum(PROVIDER_NAMES as [string, ...string[]]),
  state: z.string().min(1).max(200),
  scenario: z.enum(FAKE_SCENARIOS).optional(),
  sub: z.string().min(1).max(200).optional(),
  email: z.string().min(3).max(254).optional(),
  name: z.string().min(1).max(120).optional(),
  // Bản giả lập của Google nhận thêm tham số PKCE như bản thật – không dùng tới.
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(10).optional(),
});
type Query = z.infer<typeof query>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SCENARIO_LABELS: Record<FakeScenario, string> = {
  google_verified: 'Google – email đã xác minh',
  google_unverified: 'Google – email chưa xác minh',
  facebook_with_email: 'Facebook – có trả email',
  facebook_no_email: 'Facebook – không trả email',
  cancel: 'Bấm "Hủy" ở nhà cung cấp',
  provider_down: 'Nhà cung cấp gặp sự cố',
};

@Controller('dev/oauth/fake')
export class FakeAuthorizeController {
  constructor(@Inject(AUTH_CONFIG) private readonly auth: AuthConfig) {}

  @Get('authorize')
  @Public()
  authorize(@ValidQuery(query) q: Query, @Res() res: Response): void {
    const provider = q.provider as 'google' | 'facebook';
    if (q.scenario === undefined) {
      res.status(200).type('html').send(this.page(provider, q));
      return;
    }
    const callback = new URL(`${this.auth.webBaseUrl}/api/v1/auth/oauth/${provider}/callback`);
    callback.searchParams.set('state', q.state);
    if (q.scenario === 'cancel') {
      callback.searchParams.set('error', 'access_denied');
    } else {
      callback.searchParams.set(
        'code',
        encodeFakeCode({ scenario: q.scenario, sub: q.sub, email: q.email, name: q.name }),
      );
    }
    res.redirect(302, callback.toString());
  }

  /** Trang chọn kịch bản (dev, mở bằng trình duyệt). */
  private page(provider: 'google' | 'facebook', q: Query): string {
    const btn =
      'display:block;min-height:44px;padding:12px 16px;margin:8px 0;border-radius:8px;font-size:16px;text-decoration:none;background:#eef2ff;color:#111';
    const links = FAKE_SCENARIOS.filter((s) => scenarioFits(s, provider))
      .map((scenario) => {
        const url = new URL(`${this.auth.webBaseUrl}${FAKE_AUTHORIZE_PATH}`);
        url.searchParams.set('provider', provider);
        url.searchParams.set('state', q.state);
        url.searchParams.set('scenario', scenario);
        return `<a href="${esc(url.toString())}" style="${btn}">${esc(SCENARIO_LABELS[scenario])}</a>`;
      })
      .join('\n');
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập giả lập</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">Đăng nhập giả lập – ${esc(PROVIDER_LABELS[provider])}</h1>
<p>Đây là bản giả lập chỉ dùng khi phát triển. Chọn một kịch bản; thêm <code>&amp;email=…&amp;name=…&amp;sub=…</code> vào địa chỉ nếu cần.</p>
${links}
</body></html>`;
  }
}
