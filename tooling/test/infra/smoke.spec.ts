import { describe, expect, it } from 'vitest';
import {
  buildChecks,
  buildCrossEnvChecks,
  isDenied,
  runSmoke,
  typeOfAddress,
} from '../../infra/commands/smoke.mjs';

// T061 (007): bộ điều phối của `smoke` và mục "9 phép can-i" – kiểm bằng kube giả.

describe('runSmoke', () => {
  it('đếm đạt/lỗi/bỏ qua; mục ném lỗi thành [lỗi] mà không dừng cả bộ', async () => {
    const lines: string[] = [];
    const out = await runSmoke(
      [
        { name: 'a', run: () => Promise.resolve({ status: 'đạt', note: '' }) },
        {
          name: 'b',
          run: () => {
            throw new Error('hỏng');
          },
        },
        { name: 'c', run: () => Promise.resolve({ status: 'bỏ qua', note: 'chỉ thử nghiệm' }) },
        { name: 'd', run: () => Promise.resolve({ status: 'đạt', note: '' }) },
      ],
      (m: string) => lines.push(m),
    );
    expect(out).toMatchObject({ passed: 2, total: 3, failed: 1 });
    expect(lines.join('\n')).toContain('[lỗi] b – hỏng');
    expect(lines.join('\n')).toContain('2/3 mục đạt (1 bỏ qua)');
  });
});

interface Outcome {
  status: string;
  note: string;
}

const baseCtx = (kube: unknown) => ({
  env: 'staging',
  kube,
  domain: 'example.test',
  apiUrl: 'https://api.example.test',
  appUrl: 'https://app.example.test',
  anonymousDenied: () => Promise.resolve({ status: 'đạt', note: '' }),
});

describe('mục 9 phép kubectl auth can-i', () => {
  const find = (kube: unknown) =>
    buildChecks(baseCtx(kube)).find((c: { name: string }) => c.name.startsWith('9 phép'));

  const kubeWith = (grant: (sa: string, secret: string) => boolean) => ({
    authCanI: (_verb: string, _res: string, o: { serviceAccount: string; resourceName: string }) =>
      Promise.resolve(grant(o.serviceAccount, o.resourceName)),
  });

  it('đạt khi chỉ 3 cặp đúng trả yes', async () => {
    const pairs = {
      api: 'api-secrets',
      worker: 'worker-secrets',
      migrate: 'migrate-secrets',
    } as Record<string, string>;
    const result = (await find(kubeWith((sa, secret) => pairs[sa] === secret))?.run()) as Outcome;
    expect(result.status).toBe('đạt');
  });

  it('lỗi và nêu cặp sai khi api đọc được migrate-secrets', async () => {
    const pairs = {
      api: 'api-secrets',
      worker: 'worker-secrets',
      migrate: 'migrate-secrets',
    } as Record<string, string>;
    const result = (await find(
      kubeWith(
        (sa, secret) => pairs[sa] === secret || (sa === 'api' && secret === 'migrate-secrets'),
      ),
    )?.run()) as Outcome;
    expect(result.status).toBe('lỗi');
    expect(result.note).toContain('api→migrate-secrets=yes');
  });
});

describe('SC-004 / SC-005 (production, --infra-only)', () => {
  const deniedError = Object.assign(new Error('denied'), {
    name: 'AccessDenied',
    $metadata: { httpStatusCode: 403 },
  });

  it('isDenied nhận 403/AccessDenied, không nhận lỗi mạng', () => {
    expect(isDenied(deniedError)).toBe(true);
    expect(isDenied({ name: 'TimeoutError' })).toBe(false);
  });

  it('typeOfAddress lấy loại tài nguyên từ địa chỉ trạng thái', () => {
    expect(typeOfAddress('module.provider.aws_s3_bucket.media[0]')).toBe('aws_s3_bucket');
    expect(typeOfAddress('module.base.kubernetes_namespace_v1.this["app"]')).toBe(
      'kubernetes_namespace_v1',
    );
  });

  const runAll = async (ctx: object) => {
    const lines: string[] = [];
    const out = await runSmoke(buildCrossEnvChecks({ env: 'production', ...ctx }), (m: string) =>
      lines.push(m),
    );
    return { out, text: lines.join('\n') };
  };

  it('đạt khi hai môi trường cùng hình dạng và mọi phép chéo bị từ chối', async () => {
    const { out } = await runAll({
      componentDiff: () => Promise.resolve({ onlyA: [], onlyB: [] }),
      otherSeesProject: () => Promise.resolve(false),
      crossAttempts: [{ name: 'đọc bucket', attempt: () => Promise.reject(deniedError) }],
    });
    expect(out.failed).toBe(0);
  });

  it('một phép chéo ĐƯỢC PHÉP là lỗi nghiêm trọng', async () => {
    const { out, text } = await runAll({
      componentDiff: () => Promise.resolve({ onlyA: [], onlyB: [] }),
      crossAttempts: [{ name: 'đọc bucket', attempt: () => Promise.resolve() }],
    });
    expect(out.failed).toBe(1);
    expect(text).toContain('NGHIÊM TRỌNG');
  });

  it('khác biệt loại tài nguyên và thấy project chéo đều bị bắt', async () => {
    const { out, text } = await runAll({
      componentDiff: () => Promise.resolve({ onlyA: ['aws_s3_bucket_policy'], onlyB: [] }),
      otherSeesProject: () => Promise.resolve(true),
    });
    expect(out.failed).toBe(2);
    expect(text).toContain('aws_s3_bucket_policy');
  });
});
