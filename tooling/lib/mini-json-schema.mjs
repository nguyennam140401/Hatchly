// Bộ kiểm JSON Schema tối thiểu cho `ops/deploy/env/schema.json` (008) – tránh thêm một thư viện chỉ để
// kiểm hai tệp tham số. Hỗ trợ đúng các từ khóa lược đồ đó dùng: type, enum, const, required, properties,
// additionalProperties (false hoặc lược đồ con), minLength, minimum, pattern, allOf, if/then.
// Gặp từ khóa khác → ném lỗi (để không âm thầm bỏ qua một ràng buộc mới thêm vào lược đồ).

const SUPPORTED = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'minLength',
  'minimum',
  'pattern',
  'allOf',
  'if',
  'then',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeOf(value) {
  if (isObject(value)) return 'object';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return value === null ? 'null' : typeof value;
}

/**
 * @param {unknown} value giá trị cần kiểm
 * @param {Record<string, unknown>} schema lược đồ
 * @param {string} path đường dẫn hiện tại (vd `cluster.server`)
 * @returns {string[]} danh sách lỗi dạng "<đường dẫn>: <vấn đề>"; rỗng = hợp lệ
 */
export function validate(value, schema, path = '') {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`Từ khóa lược đồ chưa hỗ trợ: ${key}`);
  }
  const errors = [];
  const at = path === '' ? '(gốc)' : path;
  const child = (key) => (path === '' ? key : `${path}.${key}`);

  if (schema.type !== undefined) {
    const actual = typeOf(value);
    const ok = schema.type === actual || (schema.type === 'number' && actual === 'integer');
    if (!ok) return [`${at}: cần kiểu ${schema.type}, đang là ${actual}`];
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${at}: phải là một trong ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: phải bằng ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: không được để trống`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: không khớp mẫu ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${at}: phải ≥ ${schema.minimum}`);
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${child(key)}: thiếu trường bắt buộc`);
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) errors.push(...validate(item, properties[key], child(key)));
      else if (schema.additionalProperties === false) errors.push(`${child(key)}: trường lạ`);
      else if (isObject(schema.additionalProperties)) {
        errors.push(...validate(item, schema.additionalProperties, child(key)));
      }
    }
  }
  for (const part of schema.allOf ?? []) errors.push(...validate(value, part, path));
  if (schema.if !== undefined && schema.then !== undefined) {
    if (validate(value, schema.if, path).length === 0) {
      errors.push(...validate(value, schema.then, path));
    }
  }
  return errors;
}
