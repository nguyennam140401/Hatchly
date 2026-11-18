import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SNIFF_HEAD_BYTES, sniffMedia } from '../../../src/modules/media/internal/sniff';

// 014 T023 (R8, FR-004): dò nội dung thật bằng tệp mẫu – đuôi/Content-Type khai báo không được tin.

const fx = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/media', name))).subarray(
    0,
    SNIFF_HEAD_BYTES,
  );

describe('sniffMedia – tệp thật', () => {
  const ok: [string, string, 'image' | 'video', string][] = [
    ['plain.jpg', 'image/jpeg', 'image', 'image/jpeg'],
    ['exif-rotated-gps.jpg', 'image/jpeg', 'image', 'image/jpeg'],
    ['plain.png', 'image/png', 'image', 'image/png'],
    ['plain.webp', 'image/webp', 'image', 'image/webp'],
    ['plain.heic', 'image/heic', 'image', 'image/heic'],
    ['plain.heic', 'image/heif', 'image', 'image/heic'],
    ['moov-end.mp4', 'video/mp4', 'video', 'video/mp4'],
    ['faststart.mp4', 'video/mp4', 'video', 'video/mp4'],
    ['rotated90.mp4', 'video/mp4', 'video', 'video/mp4'],
  ];
  it.each(ok)('%s khai báo %s ⇒ nhận', (file, declared, kind, contentType) => {
    expect(sniffMedia(fx(file), declared)).toEqual({ kind, contentType });
  });

  it('MOV: nhận khi khai báo video/quicktime; MP4/MOV hoán đổi nhãn vẫn nhận (đều là video)', () => {
    const mov = sniffMedia(fx('clip.mov'), 'video/quicktime');
    expect(mov).toMatchObject({ kind: 'video' });
    expect(sniffMedia(fx('clip.mov'), 'video/mp4')).toMatchObject({ kind: 'video' });
  });

  it('tệp giả đuôi .jpg (HTML, EXE) và SVG có script ⇒ type_unsupported', () => {
    expect(sniffMedia(fx('fake-html.jpg'), 'image/jpeg')).toEqual({ rejected: 'type_unsupported' });
    expect(sniffMedia(fx('fake-exe.jpg'), 'image/jpeg')).toEqual({ rejected: 'type_unsupported' });
    expect(sniffMedia(fx('script.svg'), 'image/png')).toEqual({ rejected: 'type_unsupported' });
  });

  it('GIF ⇒ type_unsupported; WebP động ⇒ animated', () => {
    expect(sniffMedia(fx('animated.gif'), 'image/jpeg')).toEqual({ rejected: 'type_unsupported' });
    expect(sniffMedia(fx('animated.webp'), 'image/webp')).toEqual({ rejected: 'animated' });
  });

  it('0 byte và tệp quá ngắn ⇒ type_unsupported', () => {
    expect(sniffMedia(fx('empty.jpg'), 'image/jpeg')).toEqual({ rejected: 'type_unsupported' });
    expect(sniffMedia(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toEqual({
      rejected: 'type_unsupported',
    });
  });

  it('âm thanh M4A ⇒ type_unsupported', () => {
    const m4a = new Uint8Array(32);
    m4a.set(Buffer.from('ftypM4A '), 4);
    expect(sniffMedia(m4a, 'video/mp4')).toEqual({ rejected: 'type_unsupported' });
  });

  it('loại thật khác loại khai báo ⇒ type_mismatch', () => {
    expect(sniffMedia(fx('plain.png'), 'image/jpeg')).toEqual({ rejected: 'type_mismatch' });
    expect(sniffMedia(fx('plain.jpg'), 'video/mp4')).toEqual({ rejected: 'type_mismatch' });
    expect(sniffMedia(fx('moov-end.mp4'), 'image/jpeg')).toEqual({ rejected: 'type_mismatch' });
  });

  it('PNG động (khối acTL) ⇒ animated', () => {
    const png = Buffer.from(readFileSync(resolve(__dirname, '../../fixtures/media/plain.png')));
    // chèn khối acTL ngay sau IHDR (offset 33)
    const actl = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12)]);
    const animated = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]);
    expect(sniffMedia(new Uint8Array(animated), 'image/png')).toEqual({ rejected: 'animated' });
  });

  it('HEIF dạng chuỗi (msf1) ⇒ animated', () => {
    const seq = new Uint8Array(32);
    seq.set(Buffer.from('ftypmsf1'), 4);
    expect(sniffMedia(seq, 'image/heic')).toEqual({ rejected: 'animated' });
  });
});
