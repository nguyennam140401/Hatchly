import {
  type ArgumentsHost,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  Inject,
  Optional,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ChannelType as ChannelTypeSchema,
  ConfirmRequest,
  ConnectRequest,
  SaveConnectionRequest,
  type ChannelConnectionDto,
  type ConfirmResponse,
  type ConnectResponse,
  type DisconnectPreview,
  type DisconnectResponse,
  type OverviewResponse,
  type RecheckResponse,
  type SelectionResponse,
} from '@app/shared/platform_gateway';
import type { Response } from 'express';
import { z } from 'zod';
import {
  APP_CONFIG,
  AppError,
  AUTH_CONFIG,
  CustomerAccess,
  ValidBody,
  ValidParam,
  ValidQuery,
  type AppConfig,
  type AuthConfig,
} from '../../../../core';
import type { ChannelConnection, ChannelType } from '../../public-api';
import { ChannelNotSupportedError, ConnectionNotFoundError } from '../errors';
import { connectionNotFound, ConnectionsService } from './connections.service';

// Điểm cuối kết nối kênh (005 + 010 contracts/channels-http-api.md), tiền tố /api/v1/channels.
// Chủ: kết nối/xác nhận/ngắt (`channel.manage`); chủ + cộng tác viên: xem (`channel.view`, `status.view`). Mã tài khoản
// CHỈ từ phiên – không có ở đường dẫn/query/thân của điểm cuối khách hàng. Phản hồi KHÔNG BAO GIỜ có mã quyền. Lượt
// gọi lại: thiếu/sai phiên không trả JSON mà chuyển về trang kênh với `?error=STATE_INVALID` (bộ lọc bên dưới).

export const CONNECTIONS_SERVICE = Symbol('CONNECTIONS_SERVICE');

// `tiktok` có trong DTO dùng chung nhưng chưa là `ChannelType` của máy chủ cho tới khi có bộ chuyển đổi (T079): giá trị
// này vẫn đi vào dịch vụ, nơi công tắc chặn trước (403) và registry trả CHANNEL_NOT_SUPPORTED (422) nếu chưa đăng ký.
const asServerType = (t: z.infer<typeof ChannelTypeSchema>): ChannelType => t as ChannelType;
const channelParam = z.strictObject({ channelType: ChannelTypeSchema });
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

/** Lỗi trước/trong lượt gọi lại (thiếu phiên, thiếu quyền…) → 302 về trang kênh, không JSON. */
@Catch()
export class CallbackRedirectFilter implements ExceptionFilter {
  constructor(@Inject(AUTH_CONFIG) private readonly auth: AuthConfig) {}

  catch(_exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.redirect(302, `${this.auth.webBaseUrl}/channels?error=STATE_INVALID`);
  }
}

@Controller('channels')
export class ConnectionsController {
  constructor(
    @Inject(CONNECTIONS_SERVICE) private readonly connections: ConnectionsService,
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  /** `redirect_uri` của OAuth kênh – KHÁC redirect đăng nhập 009 (FR-005). Gốc có thể ghi đè bằng cấu hình. */
  private redirectUri(channelType: ChannelType): string {
    const base = this.config?.CHANNEL_CONNECT_REDIRECT_BASE ?? this.auth.webBaseUrl;
    return `${base.replace(/\/+$/, '')}/api/v1/channels/callback/${channelType}`;
  }

  /** Màn hình "Kênh kết nối": chỉ đọc dữ liệu đã lưu, không gọi nền tảng, không cache (FR-028). */
  @Get('overview')
  @CustomerAccess('channel.view')
  overview(@Res({ passthrough: true }) res: Response): Promise<OverviewResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.connections.overview();
  }

  @Post('connect')
  @HttpCode(200)
  @CustomerAccess('channel.manage')
  connect(@ValidBody(ConnectRequest) body: ConnectRequest): Promise<ConnectResponse> {
    const channelType = asServerType(body.channelType);
    return mapErrors(() =>
      this.connections.startConnect(channelType, this.redirectUri(channelType), {
        reconnectConnectionId: body.reconnectConnectionId,
      }),
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
    const channelType = asServerType(params.channelType);
    const outcome = await this.connections.handleCallback(
      channelType,
      query,
      this.redirectUri(channelType),
    );
    const web = this.auth.webBaseUrl;
    let target: string;
    switch (outcome.kind) {
      case 'selection':
        target = `${web}/channels/select/${encodeURIComponent(outcome.selectionId)}`;
        break;
      case 'reconnected':
        target = `${web}/channels?reconnected=${encodeURIComponent(outcome.connectionId)}`;
        break;
      case 'error':
        target = `${web}/channels?error=${outcome.code}`;
        break;
    }
    res.redirect(302, target);
  }

  @Get('selections/:selectionId')
  @CustomerAccess('channel.manage')
  selection(
    @ValidParam(selectionParam) params: z.infer<typeof selectionParam>,
  ): Promise<SelectionResponse> {
    return this.connections.getSelection(params.selectionId);
  }

  @Post('selections/:selectionId/confirm')
  @HttpCode(200)
  @CustomerAccess('channel.manage')
  confirm(
    @ValidParam(selectionParam) params: z.infer<typeof selectionParam>,
    @ValidBody(ConfirmRequest) body: ConfirmRequest,
  ): Promise<ConfirmResponse> {
    return mapErrors(() => this.connections.confirm(params.selectionId, body.externalIds));
  }

  /** 005: lưu MỘT ứng viên (giữ để tương thích). */
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

  /** Bộ chọn kênh của 012 (hình dạng cũ + trường mới tùy chọn). */
  @Get()
  @CustomerAccess('status.view')
  async list(): Promise<ChannelConnectionDto[]> {
    // KHÔNG có `tiktok`: `channel_variants` chưa hỗ trợ; đăng TikTok từ trình soạn là tính năng sau. Màn hình quản lý
    // kênh dùng `GET /channels/overview`.
    return (await this.connections.listConnections())
      .filter((c) => (c.channelType as string) !== 'tiktok')
      .map(toDto);
  }

  @Post(':connectionId/recheck')
  @HttpCode(200)
  @CustomerAccess('channel.manage')
  async recheck(
    @ValidParam(connectionParam) params: z.infer<typeof connectionParam>,
  ): Promise<RecheckResponse> {
    return mapErrors(() => this.connections.recheck(params.connectionId));
  }

  /** Hậu quả của việc ngắt: số bài đã lên lịch cho riêng kênh này + Instagram liên kết qua Page này (FR-042). */
  @Get(':connectionId/disconnect-preview')
  @CustomerAccess('channel.manage')
  disconnectPreview(
    @ValidParam(connectionParam) params: z.infer<typeof connectionParam>,
  ): Promise<DisconnectPreview> {
    return mapErrors(() => this.connections.disconnectPreview(params.connectionId));
  }

  /** Ngắt (idempotent – đã ngắt vẫn 200): xóa mã quyền ngay, thu hồi phía nền tảng nếu được (FR-017). */
  @Delete(':connectionId')
  @HttpCode(200)
  @CustomerAccess('channel.manage')
  disconnect(
    @ValidParam(connectionParam) params: z.infer<typeof connectionParam>,
  ): Promise<DisconnectResponse> {
    return mapErrors(() => this.connections.disconnect(params.connectionId));
  }
}
