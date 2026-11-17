import { Controller, Delete, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  PartUrlsBody,
  StartUploadBody,
  UploadIdParam,
  type CompleteUploadResponse,
  type PartUrlsResponse,
  type StartUploadResponse,
  type UploadStatusResponse,
} from '@app/shared/media';
import { CustomerAccess, ValidBody, ValidParam } from '../../../core';
import { UploadService } from './upload.service';

// Điểm cuối tải lên (014 contracts/media-http-api.md mục 2–6). Mọi handler có đúng một `@CustomerAccess` – quyền kiểm
// ở API. Đầu vào qua lược đồ dùng chung (`z.strictObject`: KHÔNG nhận mã tài khoản). Tệp không đi qua API: chỉ cấp
// đường dẫn ký sẵn và xác nhận.

@Controller('media/uploads')
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

  /** Bắt đầu phiên mới (201) hoặc nhận lại phiên đang mở (200). */
  @Post()
  @CustomerAccess('media.upload')
  async start(
    @ValidBody(StartUploadBody) body: StartUploadBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartUploadResponse> {
    const result = await this.uploads.start(body);
    res.status(result.status);
    return result.body;
  }

  @Post(':uploadId/part-urls')
  @CustomerAccess('media.upload')
  @HttpCode(200)
  partUrls(
    @ValidParam(UploadIdParam) params: UploadIdParam,
    @ValidBody(PartUrlsBody) body: PartUrlsBody,
  ): Promise<PartUrlsResponse> {
    return this.uploads.partUrls(params.uploadId, body.partNumbers);
  }

  @Post(':uploadId/complete')
  @CustomerAccess('media.upload')
  @HttpCode(202)
  complete(@ValidParam(UploadIdParam) params: UploadIdParam): Promise<CompleteUploadResponse> {
    return this.uploads.complete(params.uploadId);
  }

  @Get(':uploadId')
  @CustomerAccess('media.upload')
  status(@ValidParam(UploadIdParam) params: UploadIdParam): Promise<UploadStatusResponse> {
    return this.uploads.status(params.uploadId);
  }

  @Delete(':uploadId')
  @CustomerAccess('media.upload')
  @HttpCode(204)
  async cancel(@ValidParam(UploadIdParam) params: UploadIdParam): Promise<void> {
    await this.uploads.cancel(params.uploadId);
  }
}
