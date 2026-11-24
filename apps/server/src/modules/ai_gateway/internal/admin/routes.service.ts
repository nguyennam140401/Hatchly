import { Injectable } from '@nestjs/common';
import { AI_TASKS, type AiTask, type ModelTier } from '../../public-api';
import { aiAdminFunctions } from '../db/admin-functions';
import { mapAdminSqlError, routeInvalid } from './admin-errors';

// Tuyến mô hình theo bậc và bật/tắt dự phòng theo loại việc (015 T040, FR-024a). Kiểm toán `ai.route.change` /
// `ai.task_fallback.change` nằm trong hàm SQL, cùng giao dịch với cấu hình.

/** Bậc mà loại việc dùng khi gọi (khớp `pickTier`: loại sinh nội dung dùng `default`, hạ bậc theo ngưỡng mềm). */
export const TIER_OF_TASK: Record<AiTask, ModelTier> = {
  post_generation: 'default',
  topic_suggestion: 'default',
  image_labeling: 'cheap_vision',
  video_labeling: 'cheap_vision',
  transcription: 'stt',
  trend_summary: 'cheap',
};

@Injectable()
export class RoutesService {
  async setRoute(
    route: { tier: ModelTier; rank: number; provider: string; modelId: string; enabled: boolean },
    actor: string,
    trace: string | undefined,
  ): Promise<void> {
    if (route.rank !== 1 && route.rank !== 2)
      throw routeInvalid('rank chỉ nhận 1 (chính) hoặc 2 (dự phòng)');
    // Đơn vị suy từ bậc: stt tính theo phút âm thanh, còn lại theo token.
    const unit = route.tier === 'stt' ? 'audio_minute' : 'token';
    if (!(await aiAdminFunctions.modelHasPrice(route.provider, route.modelId, unit))) {
      throw routeInvalid('mô hình chưa có dòng giá nào, hãy thêm giá trước khi trỏ tuyến vào');
    }
    try {
      await aiAdminFunctions.setRoute(route, actor, trace);
    } catch (error) {
      mapAdminSqlError(error, 'route');
    }
  }

  async setTaskFallback(
    task: string,
    enabled: boolean,
    actor: string,
    trace: string | undefined,
  ): Promise<{ old: boolean | null }> {
    if (!(AI_TASKS as readonly string[]).includes(task))
      throw routeInvalid('loại việc không tồn tại');
    // Bật chỉ hợp lệ khi bậc của loại việc có tuyến rank 2; tắt luôn hợp lệ.
    if (enabled) {
      const tier = TIER_OF_TASK[task as AiTask];
      const rank2 = await aiAdminFunctions.getRoute(tier, 2);
      if (!rank2?.enabled) {
        throw routeInvalid(
          `bậc "${tier}" chưa có tuyến dự phòng (rank 2) đang bật, không bật dự phòng được`,
        );
      }
    }
    try {
      return { old: await aiAdminFunctions.setTaskFallback(task, enabled, actor, trace) };
    } catch (error) {
      return mapAdminSqlError(error, 'route');
    }
  }
}
