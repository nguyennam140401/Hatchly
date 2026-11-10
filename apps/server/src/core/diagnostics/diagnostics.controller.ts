import { Controller, HttpCode, Post } from '@nestjs/common';
import { EchoRequest, type EchoResponse } from '@app/shared/core';
import { Public } from '../auth/access.decorators';
import { ValidBody } from '../validation/decorators';

/**
 * Điểm chẩn đoán `POST /api/v1/diagnostics/echo` – chứng minh luồng kiểm tra đầu vào bằng lược đồ
 * dùng chung (FR-013a). CHỈ đăng ký khi APP_ENV ≠ production (R17).
 */
@Controller('diagnostics')
// Chỉ có khi APP_ENV ≠ production, không đọc/ghi dữ liệu khách hàng → công khai (004).
@Public()
export class DiagnosticsController {
  @Post('echo')
  @HttpCode(200)
  echo(@ValidBody(EchoRequest) body: EchoRequest): EchoResponse {
    return { message: body.message, receivedAt: new Date().toISOString() };
  }
}
