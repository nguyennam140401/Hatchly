import { describe, expect, it } from 'vitest';
import {
  POST_DISPLAY_STATUSES,
  POST_STATUS_META,
  toDisplayStatus,
  type PostDisplayStatus,
} from './post-status';

describe('toDisplayStatus', () => {
  it.each<[string, PostDisplayStatus]>([
    ['draft', 'draft'],
    ['pending_review', 'review'],
    ['approved', 'scheduled'],
    ['scheduled', 'scheduled'],
    ['publishing', 'publishing'],
    ['retry_wait', 'publishing'],
    ['published', 'published'],
    ['failed', 'attention'],
    ['unknown_outcome', 'attention'],
    ['needs_check', 'attention'],
    ['cancelled', 'cancelled'],
  ])('%s → %s', (system, expected) => {
    expect(toDisplayStatus(system)).toBe(expected);
  });

  it('giá trị lạ → unknown, không ném lỗi', () => {
    expect(toDisplayStatus('trạng-thái-mới')).toBe('unknown');
  });

  it('nhiều kênh lấy trạng thái xấu nhất', () => {
    expect(toDisplayStatus('scheduled', ['published', 'failed'])).toBe('attention');
    expect(toDisplayStatus('scheduled', ['published', 'publishing'])).toBe('publishing');
    expect(toDisplayStatus('scheduled', ['published', 'scheduled'])).toBe('scheduled');
    expect(toDisplayStatus('scheduled', ['published', 'published'])).toBe('published');
  });

  it('mọi trạng thái hiển thị có nhãn và biểu tượng', () => {
    for (const status of POST_DISPLAY_STATUSES) {
      expect(POST_STATUS_META[status].label.length).toBeGreaterThan(0);
      expect(POST_STATUS_META[status].icon.length).toBeGreaterThan(0);
    }
  });
});
