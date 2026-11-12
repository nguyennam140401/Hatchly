// Nhóm (a) – hàm thuần của module (006 research R4): so sánh "không có thay đổi", ánh xạ dòng ↔ DTO,
// gợi ý trường còn trống. Chép mẫu này khi: module có quy tắc nghiệp vụ không cần CSDL – tách ra hàm
// thuần trong `internal/` để kiểm thử nhanh, không dựng NestJS hay PostgreSQL.
import { ProfileFields, type ProfileFieldsValue } from '@app/shared/context';
import { describe, expect, it } from 'vitest';
import {
  fieldsToRow,
  missingOptional,
  rowToFields,
  sameProfileContent,
} from '../../../src/modules/context/internal/profile-content';

const full: ProfileFieldsValue = {
  industryCode: 'other',
  industryOther: 'Đồ gốm',
  introduction: 'Xưởng gốm nhỏ.',
  products: 'Bát, đĩa',
  policies: 'Đổi trả 7 ngày',
  tone: 'Ấm áp',
  keywords: ['gốm', 'thủ công'],
};

describe('sameProfileContent', () => {
  it('giống nhau sau chuẩn hóa (chỉ khác khoảng trắng) → true', () => {
    const typed = ProfileFields.parse({
      ...full,
      introduction: '  Xưởng gốm nhỏ.  ',
      keywords: [' gốm', 'thủ công '],
    });
    expect(sameProfileContent(full, typed)).toBe(true);
  });

  it('đổi thứ tự từ khóa → khác', () => {
    expect(sameProfileContent(full, { ...full, keywords: ['thủ công', 'gốm'] })).toBe(false);
  });

  it('khác một trường bất kỳ → khác', () => {
    expect(sameProfileContent(full, { ...full, tone: null })).toBe(false);
    expect(sameProfileContent(full, { ...full, keywords: ['gốm'] })).toBe(false);
  });
});

describe('ánh xạ dòng ↔ DTO', () => {
  it('hai chiều giữ nguyên nội dung', () => {
    expect(rowToFields(fieldsToRow(full))).toEqual(full);
  });

  it('không chia sẻ mảng từ khóa (sửa bản sao không đổi bản gốc)', () => {
    const row = fieldsToRow(full);
    row.keywords.push('x');
    expect(full.keywords).toHaveLength(2);
  });
});

describe('missingOptional', () => {
  it('chưa có hồ sơ → cả bốn trường tùy chọn', () => {
    expect(missingOptional(null)).toEqual(['products', 'policies', 'tone', 'keywords']);
  });

  it('chỉ liệt kê trường còn trống', () => {
    expect(missingOptional(full)).toEqual([]);
    expect(missingOptional({ ...full, policies: null, keywords: [] })).toEqual([
      'policies',
      'keywords',
    ]);
  });
});
