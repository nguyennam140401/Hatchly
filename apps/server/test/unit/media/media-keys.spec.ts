import { describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { InvalidRequestError } from '../../../src/core/storage';
import { MemoryObjectStorage } from '../../../src/core/storage/memory/memory-storage';
import {
  allLocs,
  InvalidDisplayNameError,
  normalizedLoc,
  normalizeDisplayName,
  originalLoc,
  thumbLoc,
} from '../../../src/modules/media/internal/media-keys';

// 014 T034 (R8, FR-023): khóa kho CHỈ từ tài khoản + mã media; tên tệp không bao giờ vào khóa.

describe('khóa kho của media', () => {
  const storage = new MemoryObjectStorage();
  const acc = uuidV7();
  const mediaId = uuidV7();
  const inAcc = <T>(fn: () => T): T =>
    runWithJobContext({ traceId: uuidV7(), accountId: acc }, async () => fn()) as T;

  it('dựng đúng bố cục tenants/{acc}/media/{id}/…', async () => {
    const keys = await runWithJobContext({ traceId: uuidV7(), accountId: acc }, () =>
      Promise.resolve(allLocs(mediaId).map((l) => storage.keyOf(l))),
    );
    expect(keys).toEqual([
      `tenants/${acc}/media/${mediaId}/original`,
      `tenants/${acc}/media/${mediaId}/normalized/jpeg`,
      `tenants/${acc}/media/${mediaId}/thumb`,
    ]);
    expect(inAcc).toBeDefined();
  });

  it('mã media không phải UUID (tên tệp, ../, quá dài) ⇒ từ chối, không bao giờ thành khóa', () => {
    for (const bad of ['../../etc/passwd', 'a.jpg', 'x'.repeat(300), '', mediaId + '/..']) {
      expect(() => originalLoc(bad), bad).toThrow(InvalidRequestError);
      expect(() => normalizedLoc(bad), bad).toThrow(InvalidRequestError);
      expect(() => thumbLoc(bad), bad).toThrow(InvalidRequestError);
    }
  });

  it('ngoài ngữ cảnh tài khoản ⇒ không dựng được khóa', async () => {
    expect(() => storage.keyOf(originalLoc(mediaId))).toThrow();
  });
});

describe('normalizeDisplayName', () => {
  it('giữ tiếng Việt có dấu; bỏ ký tự điều khiển, `/`, `\\`; gộp khoảng trắng', () => {
    expect(normalizeDisplayName('  Áo dài   cưới\tđỏ.jpg ')).toBe('Áo dài cưới đỏ.jpg');
    expect(normalizeDisplayName('a/b\\c\u0000d‮e.png')).toBe('abcde.png');
    expect(normalizeDisplayName('../../etc/passwd')).toBe('....etcpasswd');
  });

  it('cắt còn 255 ký tự theo điểm mã (emoji tính 1)', () => {
    const long = '😀'.repeat(300);
    expect([...normalizeDisplayName(long)]).toHaveLength(255);
    expect(normalizeDisplayName('x'.repeat(1000))).toHaveLength(255);
  });

  it('rỗng sau chuẩn hóa ⇒ lỗi', () => {
    for (const empty of ['', '   ', '\u0000\u0001', '///', '\\\\']) {
      expect(() => normalizeDisplayName(empty), JSON.stringify(empty)).toThrow(
        InvalidDisplayNameError,
      );
    }
  });

  it('chuẩn hóa NFC: ký tự rời và ký tự dựng sẵn cho cùng kết quả', () => {
    expect(normalizeDisplayName('Hué.jpg')).toBe(normalizeDisplayName('Hué.jpg'));
  });
});
