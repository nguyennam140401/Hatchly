// So hai tệp `.tfvars` (T022, contracts/environment-parameters.md): khóa nào được phép khác nhau, khóa nào phải giống.
// Bộ phân tích HCL tối thiểu cho tệp tham số (chuỗi, số, bool, null, danh sách, đối tượng); không phụ thuộc terraform
// để chạy được cả khi máy chưa cài terraform. Có kiểm thử ở tooling/test/infra/params-diff.spec.ts.

/** Khóa được phép khác nhau giữa hai môi trường (contracts/environment-parameters.md mục 1). */
export const ALLOWED_TO_DIFFER = new Set([
  'environment',
  'project_id',
  'network_cidr',
  'subnet_cidr',
  'base_domain',
  'node_groups',
  'db_instances',
  'db_storage_gb',
  'db_resources',
  'db_backup_retention_days',
  'deletion_protection',
  'admin_cidrs',
  'kms_key_id',
  'mail_capture_enabled',
  'search_indexing',
  'powered',
  'power_lock',
  'staging_keep_db_volume',
  'cdn_cname_target',
  // Chỗ dành cho giám sát của H3: phát hành chạy bộ đầy đủ nên dành nhiều hơn thử nghiệm rút gọn (T078).
  'monitoring_reserved',
]);

/**
 * Khóa "không áp dụng" ở phát hành: được phép vắng ở `production.tfvars`; khi đó so với mặc định của biến
 * (kiểm thử đối chiếu các hằng này với `variables.shared.tf`).
 */
export const NOT_APPLICABLE_DEFAULTS = Object.freeze({
  power_lock: false,
  staging_keep_db_volume: true,
  staging_max_vcpu: 8,
});

// ---------------------------------------------------------------- bộ phân tích

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  fail(message) {
    const line = this.s.slice(0, this.i).split('\n').length;
    throw new Error(`tfvars: ${message} (dòng ${line})`);
  }

  skipSpace({ newlines = true } = {}) {
    for (;;) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) this.i += 1;
      else if (c === '#' || (c === '/' && this.s[this.i + 1] === '/')) {
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i += 1;
      } else if (c === '/' && this.s[this.i + 1] === '*') {
        const end = this.s.indexOf('*/', this.i + 2);
        if (end < 0) this.fail('chú thích /* không đóng');
        this.i = end + 2;
      } else return;
    }
  }

  parseFile() {
    const out = {};
    this.skipSpace();
    while (this.i < this.s.length) {
      const key = this.parseKey();
      this.skipSpace({ newlines: false });
      if (this.s[this.i] !== '=') this.fail(`thiếu "=" sau khóa "${key}"`);
      this.i += 1;
      this.skipSpace({ newlines: false });
      out[key] = this.parseValue();
      this.skipSpace();
    }
    return out;
  }

  parseKey() {
    if (this.s[this.i] === '"') return this.parseString();
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.s.slice(this.i));
    if (m === null) this.fail('khóa không hợp lệ');
    this.i += m[0].length;
    return m[0];
  }

  parseString() {
    this.i += 1; // "
    let out = '';
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined || c === '\n') this.fail('chuỗi không đóng');
      if (c === '"') {
        this.i += 1;
        return out;
      }
      if (c === '$' && this.s[this.i + 1] === '{') this.fail('tfvars không dùng nội suy ${…}');
      if (c === '\\') {
        const n = this.s[this.i + 1];
        const map = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
        if (map[n] === undefined) this.fail(`chuỗi thoát \\${n} chưa hỗ trợ`);
        out += map[n];
        this.i += 2;
      } else {
        out += c;
        this.i += 1;
      }
    }
  }

  parseValue() {
    const c = this.s[this.i];
    if (c === '"') return this.parseString();
    if (c === '[') return this.parseList();
    if (c === '{') return this.parseObject();
    const word = /^[A-Za-z0-9_.+-]+/.exec(this.s.slice(this.i));
    if (word === null) this.fail('giá trị không hợp lệ');
    this.i += word[0].length;
    if (word[0] === 'true') return true;
    if (word[0] === 'false') return false;
    if (word[0] === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(word[0])) return Number(word[0]);
    return this.fail(`giá trị "${word[0]}" không phải chuỗi/số/bool/null`);
  }

  parseList() {
    this.i += 1;
    const out = [];
    for (;;) {
      this.skipSpace();
      if (this.s[this.i] === ']') {
        this.i += 1;
        return out;
      }
      out.push(this.parseValue());
      this.skipSpace();
      if (this.s[this.i] === ',') this.i += 1;
      else if (this.s[this.i] !== ']') this.fail('danh sách thiếu "," hoặc "]"');
    }
  }

  parseObject() {
    this.i += 1;
    const out = {};
    for (;;) {
      this.skipSpace();
      if (this.s[this.i] === '}') {
        this.i += 1;
        return out;
      }
      const key = this.parseKey();
      this.skipSpace({ newlines: false });
      if (this.s[this.i] !== '=' && this.s[this.i] !== ':')
        this.fail(`thiếu "=" sau khóa "${key}"`);
      this.i += 1;
      this.skipSpace({ newlines: false });
      out[key] = this.parseValue();
      this.skipSpace({ newlines: false });
      if (this.s[this.i] === ',') this.i += 1;
    }
  }
}

/** @param {string} text @returns {Record<string, unknown>} */
export function parseTfvars(text) {
  return new Parser(text).parseFile();
}

// ---------------------------------------------------------------- so sánh

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sameValue = (a, b) => canonical(a) === canonical(b);

/** Danh sách khóa có giá trị khác nhau (kể cả chỉ có ở một bên), theo thứ tự chữ cái. */
export function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !sameValue(a[k], b[k])).sort();
}

/** Khoảng địa chỉ IPv4 `[đầu, cuối]` của một CIDR; `null` nếu không phải IPv4 CIDR. */
export function cidrRange(cidr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr);
  if (m === null) return null;
  const octets = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return null;
  const base = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const size = 2 ** (32 - bits);
  const start = Math.floor(base / size) * size;
  return [start, start + size - 1];
}

export function cidrsOverlap(a, b) {
  const ra = cidrRange(a);
  const rb = cidrRange(b);
  if (ra === null || rb === null) return false;
  return ra[0] <= rb[1] && rb[0] <= ra[1];
}

/**
 * Kiểm hai tệp tham số của hai môi trường. Trả danh sách vấn đề (rỗng = đạt):
 *  - khóa ngoài ALLOWED_TO_DIFFER mà giá trị khác nhau;
 *  - khóa chỉ có ở một tệp (trừ khóa "không áp dụng" vắng ở phát hành, so với mặc định);
 *  - `network_cidr` của hai môi trường trùng/giao nhau.
 * @param {Record<string, unknown>} a tham số môi trường thứ nhất (staging)
 * @param {Record<string, unknown>} b tham số môi trường thứ hai (production)
 */
export function checkParams(a, b, defaults = NOT_APPLICABLE_DEFAULTS) {
  const problems = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    let va = a[key];
    let vb = b[key];
    const hasA = key in a;
    const hasB = key in b;
    if (!hasA || !hasB) {
      if (key in defaults) {
        va = hasA ? va : defaults[key];
        vb = hasB ? vb : defaults[key];
      } else if (!ALLOWED_TO_DIFFER.has(key)) {
        problems.push(
          `Khóa "${key}" chỉ có ở ${hasA ? 'staging' : 'production'}.tfvars; hai môi trường phải khai cùng một bộ khóa.`,
        );
        continue;
      }
    }
    if (!ALLOWED_TO_DIFFER.has(key) && !(key in defaults) && !sameValue(va, vb)) {
      problems.push(
        `Khóa "${key}" phải giống nhau ở hai môi trường nhưng đang khác (FR-002/FR-003).`,
      );
    } else if (key in defaults && !sameValue(va, vb) && !ALLOWED_TO_DIFFER.has(key)) {
      problems.push(
        `Khóa "${key}" phải giống nhau (hoặc cùng mặc định) ở hai môi trường nhưng đang khác.`,
      );
    }
  }
  if (
    typeof a.network_cidr === 'string' &&
    typeof b.network_cidr === 'string' &&
    cidrsOverlap(a.network_cidr, b.network_cidr)
  ) {
    problems.push(
      `network_cidr của hai môi trường trùng hoặc giao nhau (${a.network_cidr} và ${b.network_cidr}): không bao giờ được nối nhầm.`,
    );
  }
  return problems;
}
