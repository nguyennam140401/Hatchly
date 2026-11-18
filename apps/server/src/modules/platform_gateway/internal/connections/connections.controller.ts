import {
  type ArgumentsHost,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  Inject,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ChannelType as ChannelTypeSchema,
  ConnectRequest,
  SaveConnectionRequest,
  type ChannelConnectionDto,
  type ConnectResponse,
  type LegacySelectionResponse,
} from '@app/shared/platform_gateway';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AppError,
  AUTH_CONFIG,
  CustomerAccess,
  ValidBody,
  ValidParam,
  ValidQuery,
  type AuthConfig,
} from '../../../../core';
import type { ChannelConnection, ChannelType } from '../../public-api';
import { ChannelNotSupportedError, ConnectionNotFoundError } from '../errors';
import { connectionNotFound, ConnectionsService } from './connections.service';

// Điểm cuối kết nối kênh (005, contracts/platform-gateway.md mục 3), tiền tố /api/v1/channels.
// Chủ: kết nối/lưu/ngắt (`channel.manage`); chủ + cộng tác viên: liệt kê (`status.view`). Phản hồi KHÔNG
// BAO GIỜ có mã quyền. Lượt gọi lại: phiên lấy từ cookie như mọi điểm cuối khách hàng; thiếu/sai phiên
// không trả JSON mà chuyển về trang kết nối với `?error=STATE_INVALID` (bộ lọc bên dưới).

export const CONNECTIONS_SERVICE = Symbol('CONNECTIONS_SERVICE');

// `tiktok` có trong DTO dùng chung từ 010 nhưng chưa có bộ chuyển đổi (T079): luồng 005 coi như chưa hỗ trợ.
const SUPPORTED_CHANNEL_TYPES = ['facebook_page', 'instagram', 'zalo_oa', 'test_channel'] as const;
const LegacyChannelType = ChannelTypeSchema.refine(
  (value): value is (typeof SUPPORTED_CHANNEL_TYPES)[number] =>
    (SUPPORTED_CHANNEL_TYPES as readonly string[]).includes(value),
);
const channelParam = z.strictObject({ channelType: LegacyChannelType });
const selectionParam = z.strictObject({ selectionId: z.uuid() });
const connectionParam = z.strictObject({ connectionId: z.uuid() });
const callbackQuery = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(500).optional(),
  error: z.string().max(100).optional(),
});

function toDto(c: ChannelConnection): ChannelConnectionDto {
  return {
    connectionId: c.connectionId,
    channelType: c.channelType,
    displayName: c.displayName,
    externalId: c.externalId,
    status: c.status,
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    connectedAt: c.connectedAt.toISOString(),
    ...(c.state === undefined ? {} : { state: c.state }),
    ...(c.reasonCode === undefined ? {} : { reasonCode: c.reasonCode }),
    ...(c.sourceConnectionId === undefined ? {} : { sourceConnectionId: c.sourceConnectionId }),
  };
}

function channelNotSupported(): AppError {
  return new AppError({
    code: 'CHANNEL_NOT_SUPPORTED',
    httpStatus: 422,
    message: 'Kênh này chưa được hỗ trợ.',
    actions: [{ kind: 'navigate', label: 'Chọn kênh khác', href: '/channels' }],
  });
}

/** Lỗi nội bộ của cổng → lỗi HTTP chuẩn (không lộ chi tiết). */
async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConnectionNotFoundError) throw connectionNotFound();
    if (err instanceof ChannelNotSupportedError) throw channelNotSupported();
    throw err;
  }
}

/** Lỗi trước/trong lượt gọi lại (thiếu phiên, thiếu quyền…) → 302 về trang kết nối, không JSON. */
@Catch()
export class CallbackRedirectFilter implements ExceptionFilter {
  constructor(@Inject(AUTH_CONFIG) private readonly auth: AuthConfig) {}

  catch(_exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.redirect(302, `${this.auth.webBaseUrl}/channels/connect?error=STATE_INVALID`);
  }
}

@Controller('channels')
export class ConnectionsController {
  constructor(
    @Inject(CONNECTIONS_SERVICE) private readonly connections: ConnectionsService,
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
  ) {}

  private redirectUri(channelType: ChannelType): string {
    return `${this.auth.webBaseUrl}/api/v1/channels/callback/${channelType}`;
  }

  @Post('connect')
  @HttpCode(200)
  @CustomerAccess('channel.manage')
  connect(@ValidBody(ConnectRequest) body: ConnectRequest): Promise<ConnectResponse> {
    const channelType = body.channelType;
    if (channelType === 'tiktok') throw channelNotSupported(); // T079 thay bằng bộ chuyển đổi + công tắc
    return mapErrors(() =>
      this.connections.startConnect(channelType, this.redirectUri(channelType)),
    );
  }

  @Get('callback/:channelType')
  @CustomerAccess('channel.manage')
  @UseFilters(CallbackRedirectFilter)
  async callback(
    @ValidParam(channelParam) params: z.infer<typeof channelParam>,
    @ValidQuery(callbackQuery) query: z.infer<typeof callbackQuery>,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.connections.handleCallback(params.channelType, query);
    const base = `${this.auth.webBaseUrl}/channels/connect`;
    res.redirect(
      302,
      outcome.kind === 'selection'
        ? `${base}?selection=${encodeURIComponent(outcome.selectionId)}`
        : `${base}?error=${outcome.code}`,
    );
  }

  @Get('selections/:selectionId')
  @CustomerAccess('channel.manage')
  async selection(
    @ValidParam(selectionParam) params: z.infer<typeof selectionParam>,
  ): Promise<LegacySelectionResponse> {
    const view = await this.connections.getSelection(params.selectionId);
    return {
      channelType: view.channelType,
      candidates: view.candidates.map((c) => ({
        externalId: c.externalId,
        displayName: c.displayName,
        check:
          c.check.kind === 'eligible'
            ? { ...c.check, tokenExpiresAt: c.check.tokenExpiresAt.toISOString() }
            : c.check,
      })),
    };
  }

  @Post()
  @CustomerAccess('channel.manage')
  async save(
    @ValidBody(SaveConnectionRequest) body: SaveConnectionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChannelConnectionDto> {
    const { connection, created } = await mapErrors(() =>
      this.connections.saveConnection(body.selectionId, body.externalId),
    );
    res.status(created ? 201 : 200);
    return toDto(connection);
  }

  @Get()
  @CustomerAccess('status.view')
  async list(): Promise<ChannelConnectionDto[]> {
    // Bộ chọn kênh của 012: KHÔNG có `tiktok` (`channel_variants` chưa hỗ trợ; đăng TikTok từ trình soạn là tính năng sau).
    // Màn hình quản lý kênh dùng `GET /channels/overview`.
    return (await this.connections.listConnections())
      .filter((c) => (c.channelType as string) !== 'tiktok')
      .map(toDto);
  }

  @Delete(':connectionId')
  @HttpCode(204)
  @CustomerAccess('channel.manage')
  async disconnect(
    @ValidParam(connectionParam) params: z.infer<typeof connectionParam>,
  ): Promise<void> {
    await mapErrors(() => this.connections.disconnect(params.connectionId));
  }
}
