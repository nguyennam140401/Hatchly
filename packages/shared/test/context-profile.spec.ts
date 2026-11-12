// Nhóm (a) – quy tắc thuần của lược đồ dùng chung (006 FR-001, FR-001a, FR-004, data-model mục 3).
// Chép mẫu này khi: thêm lược đồ đầu vào có giới hạn độ dài/chuẩn hóa – kiểm ĐÚNG BIÊN (N đạt, N+1
// lỗi), chuẩn hóa, trường lạ bị từ chối và thông điệp tiếng Việt nguyên văn (web và API dùng chung).
import { describe, expect, it } from 'vitest';
import { toFieldErrors } from '../src/core/index.js';
import {
  charCount,
  INDUSTRIES,
  PROFILE_LIMITS,
  PROFILE_MESSAGES,
  ProfileFields,
  SaveProfileRequest,
  type ProfileFieldsInput,
} from '../src/modules/context/index.js';

const base: ProfileFieldsInput = {
  industryCode: 'fashion',
  industryOther: null,
  introduction: 'Tiệm quần áo nữ ở Đà Nẵng.',
  products: null,
  policies: null,
  tone: null,
  keywords: [],
};

function errorsOf(input: unknown): { path: string; message: string }[] {
  const r = ProfileFields.safeParse(input);
  if (r.success) return [];
  return toFieldErrors(r.error).map((e) => ({ path: e.path.join('.'), message: e.message }));
}

describe('INDUSTRIES', () => {
  it('đúng 6 ngành theo research R5, có "Khác"', () => {
    expect(INDUSTRIES.map((i) => i.code)).toEqual([
      'fashion',
      'food_beverage',
      'cosmetics',
      'education',
      'beauty_services',
      'other',
    ]);
    expect(INDUSTRIES.find((i) => i.code === 'other')?.label).toBe('Khác');
  });
});

describe('charCount – đếm theo điểm mã như char_length của PostgreSQL', () => {
  it('emoji là 1 ký tự', () => {
    expect(charCount('😀')).toBe(1);
    expect('😀'.length).toBe(2);
    expect(charCount('Tiếng Việt')).toBe(10);
  });
});

describe('ProfileFields – giới hạn đúng biên', () => {
  const cases = [
    ['introduction', PROFILE_LIMITS.introduction, PROFILE_MESSAGES.introduction],
    ['products', PROFILE_LIMITS.products, PROFILE_MESSAGES.products],
    ['policies', PROFILE_LIMITS.policies, PROFILE_MESSAGES.policies],
    ['tone', PROFILE_LIMITS.tone, PROFILE_MESSAGES.tone],
  ] as const;

  it.each(cases)('%s: %i ký tự đạt, thêm 1 ký tự lỗi', (field, max, message) => {
    expect(errorsOf({ ...base, [field]: 'a'.repeat(max) })).toEqual([]);
    expect(errorsOf({ ...base, [field]: 'a'.repeat(max + 1) })).toEqual([{ path: field, message }]);
  });

  it('emoji đếm là 1 ký tự: 2.000 emoji vẫn đạt', () => {
    expect(errorsOf({ ...base, introduction: '😀'.repeat(2000) })).toEqual([]);
    expect(errorsOf({ ...base, introduction: '😀'.repeat(2001) })).toHaveLength(1);
  });

  it('giới thiệu bắt buộc – chỉ khoảng trắng coi như rỗng', () => {
    expect(errorsOf({ ...base, introduction: '   ' })).toEqual([
      { path: 'introduction', message: 'Hãy viết vài dòng giới thiệu (tối đa 2.000 ký tự).' },
    ]);
  });

  it('mã ngành lạ → "Hãy chọn ngành kinh doanh."', () => {
    expect(errorsOf({ ...base, industryCode: '' })).toEqual([
      { path: 'industryCode', message: 'Hãy chọn ngành kinh doanh.' },
    ]);
  });
});

describe('ProfileFields – ngành "Khác"', () => {
  it('bắt buộc tên ngành 1–100 ký tự', () => {
    const msg = 'Hãy nhập tên ngành của bạn (tối đa 100 ký tự).';
    expect(errorsOf({ ...base, industryCode: 'other', industryOther: null })).toEqual([
      { path: 'industryOther', message: msg },
    ]);
    expect(errorsOf({ ...base, industryCode: 'other', industryOther: 'x'.repeat(101) })).toEqual([
      { path: 'industryOther', message: msg },
    ]);
    expect(errorsOf({ ...base, industryCode: 'other', industryOther: 'x'.repeat(100) })).toEqual(
      [],
    );
  });

  it('tên ngành bị bỏ (null) khi ngành không phải "Khác"', () => {
    const r = ProfileFields.parse({ ...base, industryOther: 'Đồ handmade' });
    expect(r.industryOther).toBeNull();
  });
});

describe('ProfileFields – chuẩn hóa', () => {
  it('cắt khoảng trắng đầu/cuối, chuỗi tùy chọn rỗng → null, từ khóa cắt và giữ thứ tự', () => {
    const r = ProfileFields.parse({
      ...base,
      industryCode: 'other',
      industryOther: '  Đồ gốm  ',
      introduction: '  Xin chào  ',
      products: '   ',
      policies: '',
      tone: ' Vui vẻ ',
      keywords: [' gốm ', 'Bát Tràng'],
    });
    expect(r).toEqual({
      industryCode: 'other',
      industryOther: 'Đồ gốm',
      introduction: 'Xin chào',
      products: null,
      policies: null,
      tone: 'Vui vẻ',
      keywords: ['gốm', 'Bát Tràng'],
    });
  });
});

describe('ProfileFields – từ khóa', () => {
  it('tối đa 20 mục', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `k${i}`);
    expect(errorsOf({ ...base, keywords: twenty })).toEqual([]);
    expect(errorsOf({ ...base, keywords: [...twenty, 'k20'] })).toEqual([
      { path: 'keywords', message: 'Tối đa 20 từ khóa – hãy xóa bớt.' },
    ]);
  });

  it('mỗi mục 1–50 ký tự', () => {
    expect(errorsOf({ ...base, keywords: ['x'.repeat(50)] })).toEqual([]);
    expect(errorsOf({ ...base, keywords: ['x'.repeat(51)] })[0]?.path).toBe('keywords.0');
    expect(errorsOf({ ...base, keywords: ['  '] })).toEqual([
      { path: 'keywords.0', message: 'Từ khóa không được để trống.' },
    ]);
  });

  it('trùng không phân biệt hoa thường', () => {
    expect(errorsOf({ ...base, keywords: ['Áo Dài', 'áo dài'] })).toEqual([
      { path: 'keywords.1', message: 'Từ khóa "áo dài" bị trùng – hãy xóa bớt.' },
    ]);
  });
});

describe('Trường lạ bị từ chối (strictObject – FR-009)', () => {
  it('accountId trong nội dung hồ sơ → lỗi', () => {
    const r = ProfileFields.safeParse({ ...base, accountId: '0190...' });
    expect(r.success).toBe(false);
  });

  it('accountId cạnh expectedVersion → lỗi', () => {
    const r = SaveProfileRequest.safeParse({ expectedVersion: 0, fields: base, accountId: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(toFieldErrors(r.error)[0]?.message).toBe('Có thông tin không được hỗ trợ.');
    }
  });

  it('đường dẫn lỗi trong yêu cầu lưu là fields.<tên>', () => {
    const r = SaveProfileRequest.safeParse({
      expectedVersion: 0,
      fields: { ...base, tone: 'x'.repeat(501) },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error)[0]?.path).toEqual(['fields', 'tone']);
  });
});
