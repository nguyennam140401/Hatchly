import {
  charCount,
  formatCount,
  INDUSTRIES,
  industryLabel,
  PROFILE_LIMITS,
  type ProfileFieldsData,
  type ProfileFieldsInput,
} from '@app/shared/context';
import type { CSSProperties } from 'react';
import { styles } from '../auth/ui';
import { KeywordsInput } from './KeywordsInput';

// Biểu mẫu hồ sơ kinh doanh (006 contracts/business-profile-ui.md "Thành phần biểu mẫu"). Không thêm thư
// viện biểu mẫu (R11): giá trị là chuỗi thô, kiểm hợp lệ bằng CHÍNH lược đồ `ProfileFields` của máy chủ.
// `readOnly`: cộng tác viên và bản cũ – mọi ô chỉ đọc, không có nút.

/** Giá trị ô nhập (chuỗi thô, chưa chuẩn hóa). */
export interface ProfileFormValue {
  industryCode: string;
  industryOther: string;
  introduction: string;
  products: string;
  policies: string;
  tone: string;
  keywords: string[];
}

export const EMPTY_FORM: ProfileFormValue = {
  industryCode: '',
  industryOther: '',
  introduction: '',
  products: '',
  policies: '',
  tone: '',
  keywords: [],
};

export function formFromFields(f: ProfileFieldsData): ProfileFormValue {
  return {
    industryCode: f.industryCode,
    industryOther: f.industryOther ?? '',
    introduction: f.introduction,
    products: f.products ?? '',
    policies: f.policies ?? '',
    tone: f.tone ?? '',
    keywords: [...f.keywords],
  };
}

export function fieldsFromForm(v: ProfileFormValue): ProfileFieldsInput {
  return { ...v, industryOther: v.industryCode === 'other' ? v.industryOther : null };
}

/** Mã ô (để đưa tiêu điểm vào ô lỗi đầu tiên). */
export const FIELD_IDS = {
  industryCode: 'bp-industryCode',
  industryOther: 'bp-industryOther',
  introduction: 'bp-introduction',
  products: 'bp-products',
  policies: 'bp-policies',
  tone: 'bp-tone',
  keywords: 'bp-keywords',
} as const;
export const FIELD_ORDER = Object.keys(FIELD_IDS) as (keyof typeof FIELD_IDS)[];

export interface ProfileFormProps {
  value: ProfileFormValue;
  onChange: (value: ProfileFormValue) => void;
  /** Lỗi theo ô, khóa là đường dẫn trong `fields` (vd "introduction", "keywords.2"). */
  errors: Record<string, string>;
  readOnly?: boolean;
}

const textarea: CSSProperties = { ...styles.input, minHeight: 96, resize: 'vertical' };

function TextArea(props: {
  id: string;
  label: string;
  value: string;
  max: number;
  error: string | undefined;
  readOnly: boolean;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  onChange: (v: string) => void;
}) {
  const n = charCount(props.value);
  const near = n >= props.max * 0.9;
  const describedBy = [`${props.id}-count`, props.error !== undefined ? `${props.id}-err` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div style={styles.field}>
      <label htmlFor={props.id}>
        {props.label}
        {props.required === true && <span aria-hidden="true"> *</span>}
      </label>
      <textarea
        id={props.id}
        style={{ ...textarea, ...(props.readOnly ? { background: '#f3f4f6' } : {}) }}
        value={props.value}
        rows={props.rows ?? 4}
        readOnly={props.readOnly}
        required={props.required}
        placeholder={props.placeholder}
        aria-invalid={props.error !== undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
      <p
        id={`${props.id}-count`}
        aria-live={near ? 'polite' : 'off'}
        style={{ margin: 0, fontSize: 14, color: n > props.max ? '#b91c1c' : '#4b5563' }}
      >
        {formatCount(n)}/{formatCount(props.max)}
      </p>
      {props.error !== undefined && (
        <p id={`${props.id}-err`} style={styles.error}>
          <span aria-hidden="true">⚠ </span>
          {props.error}
        </p>
      )}
    </div>
  );
}

export function ProfileForm({ value, onChange, errors, readOnly = false }: ProfileFormProps) {
  const set = <K extends keyof ProfileFormValue>(key: K, v: ProfileFormValue[K]) => {
    onChange({ ...value, [key]: v });
  };
  const knownIndustry = INDUSTRIES.some((i) => i.code === value.industryCode);
  const industryError = errors.industryCode;
  const otherError = errors.industryOther;

  return (
    <>
      <div style={styles.field}>
        <label htmlFor={FIELD_IDS.industryCode}>
          Ngành kinh doanh<span aria-hidden="true"> *</span>
        </label>
        <select
          id={FIELD_IDS.industryCode}
          style={{ ...styles.input, ...(readOnly ? { background: '#f3f4f6' } : {}) }}
          value={value.industryCode}
          disabled={readOnly}
          required
          aria-invalid={industryError !== undefined}
          aria-describedby={
            industryError !== undefined ? `${FIELD_IDS.industryCode}-err` : undefined
          }
          onChange={(e) => {
            set('industryCode', e.target.value);
          }}
        >
          <option value="">– Chọn ngành –</option>
          {INDUSTRIES.map((i) => (
            <option key={i.code} value={i.code}>
              {i.label}
            </option>
          ))}
          {/* Mã cũ không còn trong danh mục vẫn hiển thị được (R5). */}
          {!knownIndustry && value.industryCode !== '' && (
            <option value={value.industryCode}>{industryLabel(value.industryCode)}</option>
          )}
        </select>
        {industryError !== undefined && (
          <p id={`${FIELD_IDS.industryCode}-err`} style={styles.error}>
            <span aria-hidden="true">⚠ </span>
            {industryError}
          </p>
        )}
      </div>

      {value.industryCode === 'other' && (
        <div style={styles.field}>
          <label htmlFor={FIELD_IDS.industryOther}>
            Tên ngành<span aria-hidden="true"> *</span>
          </label>
          <input
            id={FIELD_IDS.industryOther}
            type="text"
            style={styles.input}
            value={value.industryOther}
            readOnly={readOnly}
            required
            maxLength={PROFILE_LIMITS.industryOther * 2}
            aria-invalid={otherError !== undefined}
            aria-describedby={
              otherError !== undefined ? `${FIELD_IDS.industryOther}-err` : undefined
            }
            onChange={(e) => {
              set('industryOther', e.target.value);
            }}
          />
          {otherError !== undefined && (
            <p id={`${FIELD_IDS.industryOther}-err`} style={styles.error}>
              <span aria-hidden="true">⚠ </span>
              {otherError}
            </p>
          )}
        </div>
      )}

      <TextArea
        id={FIELD_IDS.introduction}
        label="Giới thiệu"
        required
        value={value.introduction}
        max={PROFILE_LIMITS.introduction}
        error={errors.introduction}
        readOnly={readOnly}
        placeholder="Bạn bán gì, ở đâu, khác biệt ra sao…"
        onChange={(v) => {
          set('introduction', v);
        }}
      />
      <TextArea
        id={FIELD_IDS.products}
        label="Sản phẩm/dịch vụ"
        value={value.products}
        max={PROFILE_LIMITS.products}
        error={errors.products}
        readOnly={readOnly}
        onChange={(v) => {
          set('products', v);
        }}
      />
      <TextArea
        id={FIELD_IDS.policies}
        label="Chính sách (giao hàng, đổi trả…)"
        value={value.policies}
        max={PROFILE_LIMITS.policies}
        error={errors.policies}
        readOnly={readOnly}
        onChange={(v) => {
          set('policies', v);
        }}
      />
      <TextArea
        id={FIELD_IDS.tone}
        label="Giọng văn mong muốn"
        value={value.tone}
        max={PROFILE_LIMITS.tone}
        error={errors.tone}
        readOnly={readOnly}
        rows={2}
        placeholder="vd: thân thiện, xưng “mình – bạn”, ít biểu tượng cảm xúc"
        onChange={(v) => {
          set('tone', v);
        }}
      />
      <KeywordsInput
        inputId={FIELD_IDS.keywords}
        label="Từ khóa riêng"
        value={value.keywords}
        readOnly={readOnly}
        errors={errors}
        onChange={(v) => {
          set('keywords', v);
        }}
      />
    </>
  );
}
