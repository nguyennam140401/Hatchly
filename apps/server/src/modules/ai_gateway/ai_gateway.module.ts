import { Module } from '@nestjs/common';

/**
 * Module Cổng AI (`ai_gateway`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 */
@Module({})
export class AiGatewayModule {}
