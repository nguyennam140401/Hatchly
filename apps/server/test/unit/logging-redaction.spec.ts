import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  QUERYLESS_LOG_PREFIXES,
  REDACT_PATHS,
  serializeLoggedRequest,
} from '../../src/core/logging/logging.module';

// T018 (009, research R19, FR-030): nhật ký yêu cầu của /auth/oauth/* và /dev/oauth/* không có chuỗi
// truy vấn; pino che các khóa giao thức đăng nhập, mã lời mời và thông báo của Meta.

function logWith(entry: Record<string, unknown>): string {
  let out = '';
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      out += chunk.toString('utf8');
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[đã che]' } }, sink);
  logger.info(entry);
  return out;
}

describe('nhật ký yêu cầu của đường đăng nhập qua nhà cung cấp', () => {
  it('bỏ chuỗi truy vấn và `query` với đúng hai tiền tố', () => {
    expect(QUERYLESS_LOG_PREFIXES).toEqual(['/api/v1/auth/oauth/', '/api/v1/dev/oauth/']);
    const callback = serializeLoggedRequest({
      method: 'GET',
      url: '/api/v1/auth/oauth/google/callback?code=SECRET_CODE&state=SECRET_STATE',
      query: { code: 'SECRET_CODE', state: 'SECRET_STATE' },
    });
    expect(callback).toEqual({
      method: 'GET',
      url: '/api/v1/auth/oauth/google/callback',
      query: {},
    });
    const fake = serializeLoggedRequest({
      url: '/api/v1/dev/oauth/fake/authorize?scenario=google_verified&state=SECRET_STATE#x',
      query: { state: 'SECRET_STATE' },
    });
    expect(JSON.stringify(fake)).not.toContain('SECRET');
    expect(fake.url).toBe('/api/v1/dev/oauth/fake/authorize');
  });

  it('đường dẫn khác giữ nguyên (kể cả tiền tố gần giống)', () => {
    for (const url of [
      '/api/v1/context/profile?page=2',
      '/api/v1/auth/oauthx/callback?code=1',
      '/api/v1/auth/login?next=%2F',
      '/healthz',
    ]) {
      const req = { url, query: { page: '2' } };
      expect(serializeLoggedRequest(req)).toBe(req);
    }
    const noUrl: { url?: unknown; id: number } = { id: 1 };
    expect(serializeLoggedRequest(noUrl)).toBe(noUrl);
  });

  it('pino che signed_request, code_verifier, invitationToken, token, password và code/state của truy vấn', () => {
    const line = logWith({
      signed_request: 'SIGNED_MARKER',
      code_verifier: 'VERIFIER_MARKER',
      invitationToken: 'INVITE_MARKER',
      token: 'TOKEN_MARKER',
      password: 'PASSWORD_MARKER',
      body: {
        signed_request: 'SIGNED_MARKER',
        codeVerifier: 'VERIFIER_MARKER',
        invitationToken: 'INVITE_MARKER',
        token: 'TOKEN_MARKER',
        password: 'PASSWORD_MARKER',
      },
      req: { query: { code: 'CODE_MARKER', state: 'STATE_MARKER' } },
      kept: 'giữ nguyên',
    });
    expect(line).not.toMatch(/_MARKER/);
    expect(line).toContain('giữ nguyên');
    expect(line).toContain('[đã che]');
  });

  it('KHÔNG che mã lỗi và trạng thái của nhật ký vận hành (`code`, `state` ngoài truy vấn)', () => {
    const line = logWith({
      code: 'VALIDATION_FAILED',
      state: 'retry_wait',
      err: { code: '23505' },
    });
    expect(JSON.parse(line)).toMatchObject({
      code: 'VALIDATION_FAILED',
      state: 'retry_wait',
      err: { code: '23505' },
    });
  });
});
