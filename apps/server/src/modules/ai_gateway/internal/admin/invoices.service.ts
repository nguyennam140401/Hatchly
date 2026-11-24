import { Injectable } from '@nestjs/common';
import { aiAdminFunctions } from '../db/admin-functions';
import { mapAdminSqlError, settingsInvalid } from './admin-errors';

// Nhập hóa đơn nhà cung cấp để đối chiếu sổ chi phí (015 T040, FR-019a). Trùng (provider, ngày) → thay thế, kiểm toán
// `ai.invoice.enter` ghi giá trị cũ/mới trong cùng giao dịch. Hàm SQL trả `AI_SETTINGS_INVALID` cho hóa đơn sai (giữ mã).

@Injectable()
export class InvoicesService {
  async enter(
    invoice: { provider: string; invoiceDate: string; totalMicroUsd: number },
    actor: string,
    trace: string | undefined,
  ): Promise<{ replaced: boolean }> {
    if (!Number.isSafeInteger(invoice.totalMicroUsd) || invoice.totalMicroUsd < 0) {
      throw settingsInvalid('hóa đơn không hợp lệ: tổng tiền phải là số nguyên không âm');
    }
    try {
      const old = await aiAdminFunctions.enterInvoice(invoice, actor, trace);
      return { replaced: old !== null };
    } catch (error) {
      return mapAdminSqlError(error, 'invoice');
    }
  }
}
