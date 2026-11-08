import { Module } from '@nestjs/common';

/**
 * Module Nội dung (`content`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 */
@Module({})
export class ContentModule {}
