import { randomBytes } from 'node:crypto';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ChannelType as ChannelTypeSchema } from '@app/shared/platform_gateway';
import { z } from 'zod';
import { AppError, AUTH_CONFIG, Public, ValidParam, ValidQuery, type AuthConfig } from '../../../../core';

// Trang ủy quyền GIẢ của nền tảng (005, contracts/platform-gateway.md mục 4) – CHỈ development/test (được
// ghép có điều kiện). Hai nút "Đồng ý"/"Hủy" chuyển về `redirect_uri` với `code` giả hoặc
// `error=access_denied`. Chỉ chuyển về chính lượt gọi lại của ứng dụng (chống chuyển hướng mở).

const params = z.strictObject({ channelType: ChannelTypeSchema });
const query = z.object({ state: z.string().min(1).max(200), redirect_uri: z.string().max(500) });

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Controller('dev/fake-oauth')
export class FakeOauthController {
  constructor(@Inject(AUTH_CONFIG) private readonly auth: AuthConfig) {}

  @Get(':channelType/authorize')
  @Public()
  @Header('content-type', 'text/html; charset=utf-8')
  authorize(
    @ValidParam(params) p: z.infer<typeof params>,
    @ValidQuery(query) q: z.infer<typeof query>,
  ): string {
    const expected = `${this.auth.webBaseUrl}/api/v1/channels/callback/${p.channelType}`;
    if (q.redirect_uri !== expected) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        httpStatus: 400,
        message: 'Địa chỉ quay lại không hợp lệ.',
        actions: [{ kind: 'navigate', label: 'Về trang kết nối kênh', href: '/channels' }],
      });
    }
    const ok = new URL(expected);
    ok.searchParams.set('state', q.state);
    ok.searchParams.set('code', `fake_code_${randomBytes(8).toString('hex')}`);
    const cancel = new URL(expected);
    cancel.searchParams.set('state', q.state);
    cancel.searchParams.set('error', 'access_denied');
    const btn =
      'display:inline-block;min-width:44px;min-height:44px;padding:12px 20px;margin:8px;border-radius:8px;font-size:16px;text-decoration:none';
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ủy quyền giả</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
<h1 style="font-size:20px">Trang ủy quyền giả – ${esc(p.channelType)}</h1>
<p>Đây là bản giả lập chỉ dùng khi phát triển. Cho phép ứng dụng đăng bài lên kênh của bạn?</p>
<a id="approve" href="${esc(ok.toString())}" style="${btn};background:#1a7f37;color:#fff">Đồng ý</a>
<a id="cancel" href="${esc(cancel.toString())}" style="${btn};background:#eee;color:#111">Hủy</a>
</body></html>`;
  }
}
