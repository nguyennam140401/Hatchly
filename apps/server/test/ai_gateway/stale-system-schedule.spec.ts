import { describe, expect, it } from 'vitest';
import { defineStaleSystemSchedule } from '../../src/modules/ai_gateway/jobs';
import { listSchedules } from '../../src/modules/queue/schedules';

// 015 TRUNG BÌNH-4 (reviews/us1.md): ngân sách HỆ THỐNG không có việc hẹn theo từng giữ chỗ, nên lịch mỗi phút
// `ai_gateway.release_stale_system` là đường dọn duy nhất của nhánh `real`. Mức đơn vị (không cần CSDL): hàm khai báo
// lịch đăng ký đúng một lịch mỗi phút, gọi lại nhiều lần an toàn. Việc module nhánh real GỌI hàm này ở Worker không
// dựng được ở đây (nhánh real còn ném lỗi khởi động tới T049) – ghi ở báo cáo.

describe('lịch dọn giữ chỗ hệ thống treo', () => {
  it('defineStaleSystemSchedule đăng ký một lịch `* * * * *` cho release_stale_system; gọi lại không thêm, không ném', () => {
    defineStaleSystemSchedule();
    defineStaleSystemSchedule();
    const found = listSchedules().filter((s) => s.name === 'ai_gateway.release_stale_system');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cron: '* * * * *', tz: 'UTC' });
    expect(found[0]!.jobType.name).toBe('ai_gateway.release_stale_system');
    expect(found[0]!.jobType.scope).toBe('system');
  });
});
