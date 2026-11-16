import {
  charCount,
  formatCount,
  INDUSTRIES,
  industryLabel,
  PROFILE_LIMITS,
  type ProfileFieldsData,
  type ProfileFieldsInput,
} from '@app/shared/context';
import { Field } from '../../ui/field/Field';
import { cn } from '../../ui/util/cn';
import { KeywordsInput } from './KeywordsInput';

// Biểu mẫu hồ sơ kinh doanh (006 contracts/business-profile-ui.md "Thành phần biểu mẫu"). Giá trị là chuỗi thô, kiểm
// hợp lệ bằng CHÍNH lược đồ `ProfileFields` của máy chủ. Các ô dựng trên `Field` dùng chung (nhãn `for`, lỗi
// `aria-describedby`, dấu `*`). `readOnly`: cộng tác viên và bản cũ – mọi ô chỉ đọc, không có nút.
//
// Ghi chú kiến trúc (011 T074): trạng thái ô vẫn là giá trị điều khiển + `useReducer` của trang (hợp đồng 006: bộ đếm
// ký tự, so sánh "bản đang sửa" với "bản gốc", xung đột phiên bản giữ nguyên nội dung đang gõ). Chưa chuyển sang
// `useAppForm`; xem Complexity Tracking trong plan.md.

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
  const countId = `${props.id}-count`;
  return (
    <div className="flex flex-col gap-1">
      <Field
        id={props.id}
        label={props.label}
        required={props.required === true}
        error={props.error !== undefined ? { message: props.error } : undefined}
        state={props.readOnly ? 'readOnly' : 'default'}
      >
        {(c) => (
          <textarea
            {...c}
            aria-describedby={[c['aria-describedby'], countId].filter(Boolean).join(' ')}
            className={cn(c.className, 'resize-y')}
            value={props.value}
            rows={props.rows ?? 4}
            readOnly={props.readOnly}
            required={props.required}
            {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})}
            onChange={(e) => {
              props.onChange(e.target.value);
            }}
          />
        )}
      </Field>
      <p
        id={countId}
        aria-live={near ? 'polite' : 'off'}
        className={cn('text-caption', n > props.max ? 'text-danger' : 'text-ink-muted')}
      >
        {formatCount(n)}/{formatCount(props.max)}
      </p>
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
      <Field
        id={FIELD_IDS.industryCode}
        label="Ngành kinh doanh"
        required
        error={industryError !== undefined ? { message: industryError } : undefined}
        state={readOnly ? 'readOnly' : 'default'}
      >
        {(c) => (
          <select
            {...c}
            value={value.industryCode}
            disabled={readOnly}
            required
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
        )}
      </Field>

      {value.industryCode === 'other' && (
        <Field
          id={FIELD_IDS.industryOther}
          label="Tên ngành"
          required
          error={otherError !== undefined ? { message: otherError } : undefined}
          state={readOnly ? 'readOnly' : 'default'}
        >
          {(c) => (
            <input
              {...c}
              type="text"
              value={value.industryOther}
              readOnly={readOnly}
              required
              maxLength={PROFILE_LIMITS.industryOther * 2}
              onChange={(e) => {
                set('industryOther', e.target.value);
              }}
            />
          )}
        </Field>
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
