// `pnpm infra kubeconfig <env>` – lấy kubeconfig của cụm vào `infra/.credentials/<env>.kubeconfig` (T053,
// contracts/infra-cli.md mục 2, provider-layer.md mục 3). Quyền tệp chỉ chủ sở hữu; chỉ in đường dẫn, không in nội dung.
// ⏳ P6: điểm cuối VKS cần xác minh khi có tài khoản VNG Cloud thật; `fetchKubeconfig` tiêm được để kiểm thử.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { kubeconfigFile } from '../lib/paths.mjs';
import { openSession } from '../lib/session.mjs';
import { init, output } from '../lib/terraform.mjs';

const IAM_TOKEN_URL = 'https://iamapis.vngcloud.vn/accounts-api/v2/auth/token';
const VKS_API = 'https://vks.api.vngcloud.vn/v1/clusters';

/** Mặc định: đổi khóa dịch vụ lấy token IAM rồi gọi API VKS lấy kubeconfig theo `cluster.id`. ⏳ P6: xác minh. */
export async function defaultFetchKubeconfig(clusterId, creds) {
  const basic = Buffer.from(`${creds.VNGCLOUD_CLIENT_ID}:${creds.VNGCLOUD_CLIENT_SECRET}`).toString(
    'base64',
  );
  const tokenResponse = await fetch(IAM_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  if (!tokenResponse.ok) throw new Error(`IAM ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  const response = await fetch(`${VKS_API}/${encodeURIComponent(clusterId)}/kubeconfig`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`VKS ${response.status}`);
  return await response.text();
}

export async function run({ env }, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const session = await (deps.openSession ?? openSession)(env);
  await (deps.init ?? init)('cloud', env, { env: session.procEnv });
  const cloud = await (deps.output ?? output)('cloud', { env: session.procEnv });
  const clusterId = cloud?.cluster?.id;
  if (typeof clusterId !== 'string' || clusterId === '') {
    throw new CliExit(
      `Chưa có cụm của ${env} trong đầu ra stack cloud (cluster.id). Chạy pnpm infra apply ${env} --stack cloud trước.`,
      EXIT.NOT_READY,
    );
  }
  let content;
  try {
    content = await (deps.fetchKubeconfig ?? defaultFetchKubeconfig)(clusterId, session.creds);
  } catch {
    throw new CliExit(
      `Không lấy được kubeconfig của ${env} từ VKS. Kiểm tra mạng, hồ sơ chứng thực, hoặc tải từ bảng điều khiển VKS vào ${kubeconfigFile(env)}.`,
      EXIT.NOT_READY,
    );
  }
  const path = kubeconfigFile(env);
  const write =
    deps.writeFile ??
    ((p, c) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, c, { mode: 0o600 });
      chmodSync(p, 0o600);
    });
  write(path, content);
  log(`Đã ghi kubeconfig: ${path}`);
  return EXIT.OK;
}
