// Máy chủ TikTok Open API giả cho kiểm thử kết nối kênh (010 T004). Dùng lại cơ chế kịch bản của GraphStub và
// thêm BỘ ĐẾM lời gọi: kiểm thử công tắc "TikTok tắt" khẳng định `callCount === 0` ở mọi thao tác, kể cả Worker (SC-011).
import { GraphStub, type StubReply } from './graph-stub';

export class TiktokStub extends GraphStub {
  /** Tổng số yêu cầu đã nhận (0 khi công tắc tắt – không được chạm mạng). */
  get callCount(): number {
    return this.requests.length;
  }

  /** Nạp kịch bản kết nối chuẩn: đổi mã, thông tin người dùng, quyền đăng, thu hồi. */
  loadConnectScenario(opts?: {
    openId?: string;
    displayName?: string;
    refreshExpiresInSec?: number;
    scope?: string;
    maxVideoPostDurationSec?: number;
  }): this {
    const scope = opts?.scope ?? 'user.info.basic,video.publish,video.upload';
    this.on('POST /v2/oauth/token/', {
      json: {
        access_token: 'act.stub_access_token',
        refresh_token: 'rft.stub_refresh_token',
        expires_in: 86_400,
        refresh_expires_in: opts?.refreshExpiresInSec ?? 31_536_000,
        open_id: opts?.openId ?? 'tt-open-1',
        scope,
        token_type: 'Bearer',
      },
    });
    this.on('GET /v2/user/info/', {
      json: {
        data: {
          user: {
            open_id: opts?.openId ?? 'tt-open-1',
            display_name: opts?.displayName ?? 'Cửa hàng thử',
            avatar_url: 'https://cdn.example.test/tt.jpg',
          },
        },
        error: { code: 'ok' },
      },
    });
    this.on('POST /v2/post/publish/creator_info/query/', {
      json: {
        data: { max_video_post_duration_sec: opts?.maxVideoPostDurationSec ?? 600 },
        error: { code: 'ok' },
      },
    });
    this.on('POST /v2/oauth/revoke/', { json: { error: { code: 'ok' } } });
    return this;
  }
}

export const tiktokError = (code: string, status = 400): StubReply => ({
  status,
  json: { error: { code, message: 'secret-should-not-leak', log_id: 'stub' } },
});
