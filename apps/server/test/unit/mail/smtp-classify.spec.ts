import { describe, expect, it } from 'vitest';
import { classifySmtpError } from '../../../src/core/mail/smtp.transport';

// 005 T069 (R14): phân loại lỗi SMTP – 550–554 vĩnh viễn; 4xx, lỗi mạng, còn lại tạm thời.

describe('classifySmtpError', () => {
  it.each([550, 551, 552, 553, 554])('%i → permanent', (responseCode) => {
    expect(classifySmtpError({ responseCode })).toEqual({
      kind: 'permanent',
      code: String(responseCode),
    });
  });
  it.each([421, 450, 451, 452])('%i → transient', (responseCode) => {
    expect(classifySmtpError({ responseCode })).toEqual({
      kind: 'transient',
      code: String(responseCode),
    });
  });
  it.each(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET'])('%s → transient', (code) => {
    expect(classifySmtpError({ code })).toEqual({ kind: 'transient', code });
  });
  it('lỗi khác → transient; không lộ thông điệp gốc', () => {
    expect(classifySmtpError(new Error('user:pass@smtp'))).toEqual({
      kind: 'transient',
      code: 'UNKNOWN',
    });
    expect(classifySmtpError(undefined)).toEqual({ kind: 'transient', code: 'UNKNOWN' });
    expect(classifySmtpError({ responseCode: 500 })).toEqual({ kind: 'transient', code: '500' });
  });
});
