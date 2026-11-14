import { describe, expect, it } from 'vitest';
import { selectImages } from '../../ops/ci/scripts/prune-images.mjs';

// 008 T088 (FR-025): luật chọn ảnh giữ / xóa – giữ 10 lần release thành công gần nhất VÀ mọi ảnh dưới 90 ngày.

const NOW = new Date('2026-12-01T00:00:00Z');
const sha = (n: number) => n.toString(16).padStart(40, '0');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** `count` lần triển khai release thành công, mới → cũ, cách nhau `step` ngày kể từ `start` ngày trước. */
const releases = (count: number, start: number, step: number) =>
  Array.from({ length: count }, (_, i) => ({
    sha: sha(i + 1),
    createdAt: daysAgo(start + i * step),
    kind: 'release',
    success: true,
  }));

describe('selectImages', () => {
  it('giữ 10 release gần nhất dù đã quá 90 ngày; xóa phần cũ hơn', () => {
    const deployments = releases(14, 100, 5); // tất cả đều > 90 ngày
    const tags = deployments.map((d) => d.sha);
    const { keep, remove } = selectImages({ tags, deployments, now: NOW });
    expect(keep).toEqual(tags.slice(0, 10));
    expect(remove).toEqual(tags.slice(10));
  });

  it('giữ mọi ảnh dưới 90 ngày dù ngoài 10 bản gần nhất', () => {
    const deployments = releases(15, 1, 2); // 15 bản trong ~29 ngày
    const tags = deployments.map((d) => d.sha);
    const { keep, remove } = selectImages({ tags, deployments, now: NOW });
    expect(keep).toHaveLength(15);
    expect(remove).toEqual([]);
  });

  it('lần triển khai thất bại không được tính vào 10 bản gần nhất', () => {
    const failed = Array.from({ length: 5 }, (_, i) => ({
      sha: sha(100 + i),
      createdAt: daysAgo(200 + i),
      kind: 'release',
      success: false,
    }));
    const ok = releases(10, 300, 1);
    const deployments = [...failed, ...ok];
    const tags = deployments.map((d) => d.sha);
    const { keep, remove } = selectImages({ tags, deployments, now: NOW });
    expect(keep).toEqual(ok.map((d) => d.sha));
    expect(remove).toEqual(failed.map((d) => d.sha));
  });

  it('thẻ không có bản ghi triển khai nào thì GIỮ (không xóa thứ không dò được nguồn gốc)', () => {
    const deployments = releases(1, 300, 1);
    const orphan = sha(999);
    const { keep } = selectImages({ tags: [deployments[0]!.sha, orphan], deployments, now: NOW });
    expect(keep).toContain(orphan);
  });

  it('redeploy không chiếm chỗ trong 10 bản release', () => {
    const redeploys = Array.from({ length: 5 }, (_, i) => ({
      sha: sha(500 + i),
      createdAt: daysAgo(200 + i),
      kind: 'redeploy',
      success: true,
    }));
    const rel = releases(10, 300, 1);
    const deployments = [...redeploys, ...rel];
    const tags = deployments.map((d) => d.sha);
    const { remove } = selectImages({ tags, deployments, now: NOW });
    expect(remove).toEqual(redeploys.map((d) => d.sha));
  });
});
