import { Injectable } from '@nestjs/common';
import { aiAdminFunctions, type AddPriceInput, type PriceUnit } from '../db/admin-functions';
import { PRICE_CACHE_TTL_MS, mapAdminSqlError, priceImplausible } from './admin-errors';

// Thêm dòng giá mô hình (015 T039, FR-019a). Bảng giá chỉ-thêm: không sửa/xóa dòng cũ. Kiểm tra mềm ở đây TRƯỚC khi ghi;
// ghi + kiểm toán `ai.price.add` nằm trong một giao dịch ở hàm SQL (uuid v7 của dòng giá sinh ở `addPrice`).

export { PRICE_CACHE_TTL_MS };

const FIELDS = [
  ['inputPerMTok', 'giá đầu vào'],
  ['outputPerMTok', 'giá đầu ra'],
  ['cachedInputPerMTok', 'giá đầu vào đã đệm'],
  ['perMinute', 'giá theo phút'],
] as const;

/** Trường giá dùng cho đơn vị; trường khác phải vắng. */
const FIELDS_OF_UNIT: Record<PriceUnit, readonly (typeof FIELDS)[number][0][]> = {
  token: ['inputPerMTok', 'outputPerMTok', 'cachedInputPerMTok'],
  audio_minute: ['perMinute'],
};

@Injectable()
export class PricingService {
  async addPrice(
    input: AddPriceInput,
    actor: string,
    trace: string | undefined,
  ): Promise<{ priceId: string }> {
    // 1. Giá > 0 theo đơn vị (hàm SQL có CHECK tương ứng làm lớp thứ hai).
    for (const [field, label] of FIELDS) {
      const value = input[field];
      if (value === undefined || value === null) continue;
      if (!(FIELDS_OF_UNIT[input.unit] as readonly string[]).includes(field)) {
        throw priceImplausible(`${label} không áp dụng cho đơn vị ${input.unit}`);
      }
      if (!Number.isSafeInteger(value) || value <= 0)
        throw priceImplausible(`${label} phải lớn hơn 0`);
    }

    // 2. Hiệu lực ≥ now + TTL đệm (SC-007) và lệch ≤ 10× đều kiểm ở hàm SQL `admin_add_price` theo đồng hồ CSDL (nguồn tin
    //    cậy; không kiểm trùng ở đây vì đồng hồ API có thể lệch); lỗi SQL được ánh xạ thành 422 ở `mapAdminSqlError`.
    try {
      const { priceId } = await aiAdminFunctions.addPrice(input, actor, trace);
      return { priceId };
    } catch (error) {
      return mapAdminSqlError(error, 'price');
    }
  }
}
