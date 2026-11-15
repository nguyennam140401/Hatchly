import { createHmac } from 'node:crypto';

// T079 (009, FR-009a): tạo `signed_request` hợp lệ của Meta cho một mã người dùng Facebook.
// - Hàm: dùng trong kiểm thử.
// - CLI (kiểm tay ở dev): `FACEBOOK_APP_SECRET=… pnpm --filter @app/server exec tsx
//   test/support/make-signed-request.ts <fb_user_id>` → in chuỗi ra stdout.

export function makeSignedRequest(
  userId: string,
  appSecret: string,
  overrides: Record<string, unknown> = {},
): string {
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: 'HMAC-SHA256',
      issued_at: Math.floor(Date.now() / 1000),
      user_id: userId,
      ...overrides,
    }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', appSecret).update(payload, 'utf8').digest('base64url');
  return `${signature}.${payload}`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('test/support/make-signed-request.ts') === true) {
  const [userId] = process.argv.slice(2);
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (userId === undefined || secret === undefined) {
    process.stderr.write(
      'Cách dùng: FACEBOOK_APP_SECRET=… tsx make-signed-request.ts <fb_user_id>\n',
    );
    process.exit(2);
  }
  process.stdout.write(`${makeSignedRequest(userId, secret)}\n`);
}
