import { Module } from '@nestjs/common';

/**
 * Module Ngữ cảnh kinh doanh (`context`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 */
@Module({})
export class ContextModule {}
