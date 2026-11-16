import { describe, expect, it } from 'vitest';
import { COUNTER_KEY, MUTATIONS } from './mutations';
import { queryKeys } from './query-keys';

const sample = { id: 'p1', jobId: 'j1' };
const keys = (name: keyof typeof MUTATIONS) =>
  (
    MUTATIONS[name].invalidates as unknown as (
      v: unknown,
      r: unknown,
    ) => readonly (readonly unknown[])[]
  )(sample, sample).map((k) => JSON.stringify(k));

describe('MUTATIONS (ma trận vô hiệu hóa)', () => {
  it('mọi thao tác có `invalidates` không rỗng', () => {
    for (const name of Object.keys(MUTATIONS) as (keyof typeof MUTATIONS)[]) {
      expect(keys(name).length, name).toBeGreaterThan(0);
    }
  });

  it('thao tác làm đổi số đếm có kèm khóa đếm tương ứng (chặn quên)', () => {
    for (const [name, spec] of Object.entries(MUTATIONS)) {
      for (const counter of spec.changes ?? []) {
        expect(keys(name as keyof typeof MUTATIONS), `${name} → ${counter}`).toContain(
          JSON.stringify(COUNTER_KEY[counter]),
        );
      }
    }
  });

  it('khớp bảng của contracts/data-layer.md mục 3', () => {
    expect(keys('approvePost')).toEqual(
      expect.arrayContaining([
        JSON.stringify(queryKeys.posts.detail('p1')),
        JSON.stringify(queryKeys.posts.lists()),
        JSON.stringify(queryKeys.counters.pendingReview()),
        JSON.stringify(queryKeys.overview.all()),
        JSON.stringify(queryKeys.notifications.unread()),
      ]),
    );
    expect(keys('reschedule')).toContain(JSON.stringify(queryKeys.calendar.all()));
    expect(keys('uploadMedia')).toEqual(
      expect.arrayContaining([
        JSON.stringify(queryKeys.media.lists()),
        JSON.stringify(queryKeys.usage.current()),
      ]),
    );
    expect(keys('saveProfile')).toEqual(
      expect.arrayContaining([
        JSON.stringify(queryKeys.profile.current()),
        JSON.stringify(queryKeys.profile.versions()),
      ]),
    );
    expect(keys('inviteMember')).toEqual(
      expect.arrayContaining([
        JSON.stringify(queryKeys.members.list()),
        JSON.stringify(queryKeys.session.me()),
      ]),
    );
    expect(keys('bulkCreatePosts')).toContain(JSON.stringify(queryKeys.jobs.detail('j1')));
  });

  it('không khóa nào chứa mã tài khoản', () => {
    for (const name of Object.keys(MUTATIONS) as (keyof typeof MUTATIONS)[]) {
      for (const k of keys(name)) expect(k.toLowerCase()).not.toMatch(/account|tenant/);
    }
  });
});
