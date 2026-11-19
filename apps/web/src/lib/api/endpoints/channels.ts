import {
  ConfirmResponse,
  ConnectResponse,
  DisconnectPreview,
  DisconnectResponse,
  OverviewResponse,
  RecheckResponse,
  SelectionResponse,
  type ConnectableChannelType,
} from '@app/shared/platform_gateway';
import { apiClient } from '../client';

// Lời gọi API "Kênh kết nối" (010, contracts/channels-http-api.md). Phản hồi kiểm bằng lược đồ dùng chung; KHÔNG BAO GIỜ có mã
// quyền; web không gửi mã tài khoản (lấy từ phiên). `overview` chỉ đọc dữ liệu đã lưu – không gọi nền tảng.

const C = '/api/v1/channels';

export const channelsApi = {
  overview: (signal?: AbortSignal) =>
    apiClient.request('GET', `${C}/overview`, {
      schema: OverviewResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  /** Bắt đầu (hoặc kết nối lại: `reconnectConnectionId`). Trả địa chỉ ủy quyền – bên gọi điều hướng trình duyệt tới đó. */
  connect: (channelType: ConnectableChannelType, reconnectConnectionId?: string) =>
    apiClient.request('POST', `${C}/connect`, {
      body: {
        channelType,
        ...(reconnectConnectionId !== undefined ? { reconnectConnectionId } : {}),
      },
      schema: ConnectResponse,
    }),
  selection: (selectionId: string) =>
    apiClient.request('GET', `${C}/selections/${encodeURIComponent(selectionId)}`, {
      schema: SelectionResponse,
    }),
  confirm: (selectionId: string, externalIds: string[]) =>
    apiClient.request('POST', `${C}/selections/${encodeURIComponent(selectionId)}/confirm`, {
      body: { externalIds },
      schema: ConfirmResponse,
    }),
  recheck: (connectionId: string) =>
    apiClient.request('POST', `${C}/${encodeURIComponent(connectionId)}/recheck`, {
      body: {},
      schema: RecheckResponse,
    }),
  disconnectPreview: (connectionId: string) =>
    apiClient.request('GET', `${C}/${encodeURIComponent(connectionId)}/disconnect-preview`, {
      schema: DisconnectPreview,
    }),
  disconnect: (connectionId: string) =>
    apiClient.request('DELETE', `${C}/${encodeURIComponent(connectionId)}`, {
      schema: DisconnectResponse,
    }),
};
