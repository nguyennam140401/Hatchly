// Điểm cuối kiểm tra khói sau triển khai (008 FR-032, contracts/deploy-pipeline.md mục 3): chứng minh API ghi
// được CSDL bằng vai trò `app` và Worker nhận việc qua hàng chờ. Không đọc/ghi dữ liệu khách hàng, không gọi
// nền tảng/AI/email. Cần `SMOKE_TOKEN`; không có mã → 404 như đường dẫn không tồn tại.
import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { APP_CONFIG, Public, uuidV7, type AppConfig } from '../../../../core';
// authTx chỉ dành cho core/auth và modules/account/internal/auth, trừ ngoại lệ có chú thích lý do ở
// tooling/boundaries/build-rules.cjs: bảng infra.smoke_pings là bảng dùng chung, không có dữ liệu khách hàng.
import { authTx } from '../../../../core/db/auth-tx';
import { enqueue } from '../producer';
import { smokePingJob } from '../../jobs';
import { smokePings } from '../db/schema';
import { SmokeTokenGuard } from './smoke-token.guard';

/** Giới hạn mỗi bản API: 10 yêu cầu tạo mỗi phút (cửa sổ cố định 60 giây). */
export const SMOKE_RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

export interface SmokePingStatus {
  id: string;
  requestedAt: string;
  apiVersion: string;
  processedAt: string | null;
  workerVersion: string | null;
}

@Controller('ops/smoke')
// Công khai về phiên đăng nhập nhưng bị SmokeTokenGuard chặn bằng mã riêng; không có dữ liệu tenant.
@Public()
@UseGuards(SmokeTokenGuard)
export class SmokeController {
  private windowStart = 0;
  private count = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private takeToken(now: number): boolean {
    if (now - this.windowStart >= WINDOW_MS) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= SMOKE_RATE_LIMIT;
  }

  @Post()
  @HttpCode(202)
  async create(): Promise<{ id: string }> {
    if (!this.takeToken(Date.now())) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    const id = uuidV7();
    await authTx(async (db) => {
      await db.insert(smokePings).values({
        id,
        requested_at: new Date(),
        api_version: this.config.APP_VERSION,
      });
      // Cùng một giao dịch: giao dịch hủy thì không có cả dòng lẫn việc.
      await enqueue(smokePingJob, { pingId: id });
    });
    return { id };
  }

  @Get(':id')
  async status(@Param('id') id: string): Promise<SmokePingStatus> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const row = await authTx(async (db) => {
      const rows = await db.select().from(smokePings).where(eq(smokePings.id, id)).limit(1);
      return rows[0];
    });
    if (row === undefined) throw new NotFoundException();
    return {
      id: row.id,
      requestedAt: row.requested_at.toISOString(),
      apiVersion: row.api_version,
      processedAt: row.processed_at?.toISOString() ?? null,
      workerVersion: row.worker_version,
    };
  }
}
