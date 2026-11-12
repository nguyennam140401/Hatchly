import type { AiTask, ModelTier } from '../public-api';

// Chọn hạng mô hình (005, R7, ADD Cổng AI mục 5) – bên gọi KHÔNG chọn được mô hình (FR-033). Quyết định
// dựa trên `used + reserved` của ảnh chụp đọc khi giữ chỗ; lời gọi đẩy qua ngưỡng mềm vẫn dùng `default`
// (chấp nhận vượt tối đa một lời gọi).

export function pickTier(task: AiTask, snapshot: { used: number; reserved: number; softLimit: number }): ModelTier {
  switch (task) {
    case 'image_labeling':
    case 'video_labeling':
      return 'cheap_vision';
    case 'trend_summary':
      return 'cheap';
    case 'transcription':
      return 'stt';
    case 'post_generation':
    case 'topic_suggestion':
      return snapshot.used + snapshot.reserved < snapshot.softLimit ? 'default' : 'cheap';
  }
}
