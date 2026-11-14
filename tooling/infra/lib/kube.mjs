// Bọc `kubectl` cho `pnpm infra` (T021). Spawn không qua shell; KUBECONFIG trỏ `infra/.credentials/<env>.kubeconfig`.
// Giá trị bí mật chỉ đi qua stdin, không bao giờ qua đối số dòng lệnh và không bao giờ trả ra ngoài.
import { existsSync } from 'node:fs';
import { CliExit, EXIT } from './exit-codes.mjs';
import { kubeconfigFile } from './paths.mjs';
import { run } from './process.mjs';

/** Ném `CliExit` (mã 4) nêu lệnh cần chạy khi thiếu kubeconfig. */
export function assertKubeconfig(env) {
  const path = kubeconfigFile(env);
  if (!existsSync(path)) {
    throw new CliExit(
      `Chưa có kubeconfig của ${env}. Chạy: pnpm infra kubeconfig ${env}`,
      EXIT.NOT_READY,
    );
  }
  return path;
}

export function createKube(env, deps = {}) {
  const exec =
    deps.exec ??
    (async (args, input) => {
      const kubeconfig = assertKubeconfig(env);
      try {
        return await run('kubectl', args, { env: { KUBECONFIG: kubeconfig }, input });
      } catch {
        throw new CliExit('Không chạy được kubectl. Cài kubectl rồi chạy lại.', EXIT.NOT_READY);
      }
    });

  async function ok(args, input) {
    const r = await exec(args, input);
    if (r.code !== 0)
      throw new CliExit(`kubectl ${args[0]} lỗi: ${firstLine(r.stderr)}`, EXIT.ERROR);
    return r.stdout;
  }

  return {
    async get(kind, name, namespace) {
      const args = [
        'get',
        kind,
        ...(name ? [name] : []),
        ...(namespace ? ['-n', namespace] : []),
        '-o',
        'json',
      ];
      const r = await exec(args);
      if (r.code !== 0) {
        if (/NotFound|not found/i.test(r.stderr)) return null;
        throw new CliExit(`kubectl get ${kind} lỗi: ${firstLine(r.stderr)}`, EXIT.ERROR);
      }
      return JSON.parse(r.stdout);
    },
    async applyStdin(manifest) {
      return await ok(
        ['apply', '-f', '-'],
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      );
    },
    /** `kubectl auth can-i <động từ> <tài nguyên> [--as=system:serviceaccount:<ns>:<sa>]` → boolean. */
    async authCanI(verb, resource, { serviceAccount, namespace = 'app', resourceName } = {}) {
      const target = resourceName ? `${resource}/${resourceName}` : resource;
      const args = ['auth', 'can-i', verb, target, '-n', namespace];
      if (serviceAccount) args.push(`--as=system:serviceaccount:${namespace}:${serviceAccount}`);
      const r = await exec(args);
      return r.stdout.trim() === 'yes';
    },
    async waitFor(kind, name, condition, { namespace, timeoutSeconds = 300 } = {}) {
      const args = [
        'wait',
        `--for=${condition}`,
        `${kind}/${name}`,
        `--timeout=${timeoutSeconds}s`,
      ];
      if (namespace) args.push('-n', namespace);
      const r = await exec(args);
      return r.code === 0;
    },
    /** Chỉ TÊN khóa của một `Secret` (không bao giờ giá trị). `null` khi chưa có Secret. */
    async secretKeys(namespace, name) {
      const secret = await this.get('secret', name, namespace);
      if (secret === null) return null;
      return Object.keys(secret.data ?? {}).sort();
    },
    /** Chú thích của `Secret` (nguồn, thời điểm xoay) – không đụng `data`. */
    async secretAnnotations(namespace, name) {
      const secret = await this.get('secret', name, namespace);
      return secret === null ? null : (secret.metadata?.annotations ?? {});
    },
    /**
     * Ghi một khóa vào `Secret` bằng server-side apply qua stdin (chạy được trên Windows; chỉ động tới khóa này,
     * các khóa khác giữ nguyên). `value` là Buffer/chuỗi, được base64 hóa; không bao giờ đi qua đối số dòng lệnh.
     * @param {{ annotations?: Record<string,string>, type?: string }} [options]
     */
    async patchSecretKey(namespace, name, key, value, { annotations = {}, type = 'Opaque' } = {}) {
      const manifest = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name,
          namespace,
          ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
        },
        type,
        data: { [key]: Buffer.from(value).toString('base64') },
      };
      return await ok(
        ['apply', '--server-side', '--field-manager=pnpm-infra', '--force-conflicts', '-f', '-'],
        JSON.stringify(manifest),
      );
    },
    /** Giá trị đã giải mã của một Secret – CHỈ dùng nội bộ để dựng chuỗi kết nối; không bao giờ in ra. */
    async secretValues(namespace, name) {
      const secret = await this.get('secret', name, namespace);
      if (secret === null) return null;
      return Object.fromEntries(
        Object.entries(secret.data ?? {}).map(([k, v]) => [
          k,
          Buffer.from(v, 'base64').toString('utf8'),
        ]),
      );
    },
    async annotate(kind, name, namespace, annotations) {
      const pairs = Object.entries(annotations).map(([k, v]) => `${k}=${v}`);
      return await ok(['annotate', '--overwrite', kind, name, '-n', namespace, ...pairs]);
    },
    exec,
  };
}

function firstLine(text) {
  return (text.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 300);
}
