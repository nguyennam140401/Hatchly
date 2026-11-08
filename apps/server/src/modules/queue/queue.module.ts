import { Module } from '@nestjs/common';

/**
 * Module Hàng chờ (hạ tầng) (`queue`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 */
@Module({})
export class QueueModule {}
