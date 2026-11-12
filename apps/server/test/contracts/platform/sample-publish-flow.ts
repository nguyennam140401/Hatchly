import type { PlatformGatewayPublicApi } from '../../../src/modules/platform_gateway';

// Luồng gọi MẪU mô phỏng phía Đăng bài (005, US2, SC-002): chỉ rẽ nhánh theo `capabilities` và `kind`,
// KHÔNG có tên nền tảng nào trong tệp này (kiểm thử khẳng định tĩnh). Thêm kênh không đổi dòng nào ở đây.

export type SampleOutcome =
  | { kind: 'published'; platformPostId: string }
  | { kind: 'failed'; category: 'transient' | 'user_action' }
  | { kind: 'needs_check' };

export async function samplePublishFlow(
  gateway: PlatformGatewayPublicApi,
  input: { connectionId: string; text: string; sentAt: Date },
): Promise<SampleOutcome> {
  const conn = await gateway.getConnection(input.connectionId);
  if (conn === null) throw new Error('Không có kết nối');
  const caps = gateway.capabilities(conn.channelType);
  const contentHash = gateway.contentHash(conn.channelType, input.text);
  const submitted = await gateway.submit({
    connectionId: input.connectionId,
    text: input.text,
    media: [],
    contentHash,
  });

  let result = submitted;
  if (result.kind === 'processing' && caps.asyncProcessing) {
    for (let i = 0; i < 5; i++) {
      const status = await gateway.checkStatus(input.connectionId, result.processingId);
      if (status.kind === 'processing') continue;
      if (status.kind === 'done')
        return { kind: 'published', platformPostId: status.platformPostId };
      result = status;
      break;
    }
  }
  switch (result.kind) {
    case 'published':
      return { kind: 'published', platformPostId: result.platformPostId };
    case 'processing':
      return { kind: 'needs_check' };
    case 'failed': {
      if (result.error.category !== 'unknown')
        return { kind: 'failed', category: result.error.category };
      if (!caps.reconcile) return { kind: 'needs_check' };
      const rec = await gateway.reconcile({
        connectionId: input.connectionId,
        contentHash,
        from: new Date(input.sentAt.getTime() - 60_000),
        to: new Date(),
      });
      if (rec.kind === 'found') return { kind: 'published', platformPostId: rec.platformPostId };
      // not_found mới được phép gửi lại (luồng thật làm ở bước sau); unsupported → "Cần kiểm tra".
      return { kind: 'needs_check' };
    }
  }
}
