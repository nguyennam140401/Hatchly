import { Injectable } from '@nestjs/common';
import { aiAdminFunctions, type SettingsPatch } from '../db/admin-functions';
import { mapAdminSqlError, settingsInvalid } from './admin-errors';

// Đổi cấu hình ngân sách AI (015 T040, FR-019a): trần tài khoản, ngưỡng mềm, trần hằng tuần theo ngành. Áp cho chu kỳ/tuần
// tạo sau (chu kỳ đã có giữ nguyên ảnh chụp). Kiểm toán `ai.settings.change {field, old, new}` mỗi trường đổi, cùng giao dịch.

@Injectable()
export class SettingsService {
  async change(
    patch: SettingsPatch,
    actor: string,
    trace: string | undefined,
  ): Promise<{ changed: number }> {
    const current = await aiAdminFunctions.getSettings();
    const cap = patch.accountCapMicroUsd ?? current.accountCapMicroUsd;
    const soft = patch.accountSoftLimitMicroUsd ?? current.accountSoftLimitMicroUsd;
    // Kiểm tra cả giá trị gộp với cấu hình hiện có.
    if (soft >= cap) {
      throw settingsInvalid(
        'hạn mức mềm phải nhỏ hơn trần tài khoản (kể cả khi gộp với cấu hình hiện có)',
      );
    }
    try {
      return { changed: await aiAdminFunctions.setSettings(patch, actor, trace) };
    } catch (error) {
      return mapAdminSqlError(error, 'settings');
    }
  }
}
