// Sinh tệp giá trị Helm từ tham số môi trường (008 T071, contracts/deploy-pipeline.md mục 3).
// Dùng: node ops/deploy/scripts/render-values.mjs --env staging --sha <sha> --digest sha256:… [--file ops/deploy/env/staging.yaml]
// In YAML ra stdout. Từ chối khi: tham số sai lược đồ (ops/deploy/env/schema.json), `--env` ≠ `name` trong tệp,
// SHA / digest sai định dạng. KHÔNG chứa bí mật: `envFromSecret` chỉ là TÊN Secret trong cụm.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate } from '../../../tooling/lib/mini-json-schema.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// `yaml` là phụ thuộc của @app/tooling (pnpm không đưa lên thư mục gốc).
const { parse, stringify } = createRequire(`${root}tooling/package.json`)('yaml');

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * @param {object} params nội dung ops/deploy/env/<env>.yaml đã đọc
 * @param {{env: string, sha: string, digest: string}} input
 */
export function renderValues(params, input, schema) {
  const problems = validate(params, schema);
  if (problems.length > 0)
    throw new Error(`Tham số môi trường sai lược đồ:\n- ${problems.join('\n- ')}`);
  if (params.name !== input.env) {
    throw new Error(
      `--env "${input.env}" không khớp name "${params.name}" trong tệp tham số (không ánh xạ chéo – FR-003)`,
    );
  }
  if (!SHA.test(input.sha)) throw new Error('--sha phải là SHA commit đầy đủ 40 ký tự hex');
  if (!DIGEST.test(input.digest)) throw new Error('--digest phải dạng sha256:<64 hex>');
  if (!params.provisioned)
    throw new Error(`Môi trường ${params.name} chưa có (provisioned: false) – không sinh giá trị`);
  const host = new URL(params.api.baseUrl).host;
  return {
    image: { repository: params.registry.repository, digest: input.digest },
    appVersion: input.sha,
    replicas: { api: params.replicas.api, worker: params.replicas.worker },
    ingress: { host },
    envFromSecret: params.secrets.app,
    config: {
      APP_ENV: params.name,
      CORS_ORIGINS: params.web.baseUrl,
    },
  };
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const env = flag('--env');
  const file = flag('--file') ?? `ops/deploy/env/${env}.yaml`;
  try {
    const params = parse(readFileSync(file, 'utf8'));
    const schema = JSON.parse(readFileSync(`${root}ops/deploy/env/schema.json`, 'utf8'));
    const values = renderValues(
      params,
      { env, sha: flag('--sha') ?? '', digest: flag('--digest') ?? '' },
      schema,
    );
    process.stdout.write(stringify(values));
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
