import { Injectable } from '@nestjs/common';
import type { Actor } from '../context/actor.types';

// Bộ nhớ đệm phiên trong tiến trình (004, R3, data-model.md mục 7): token_hash (hex) → người gọi.
// Sống ≤ 60 giây (và không quá hạn tuyệt đối của phiên), tối đa 10.000 mục, đầy thì bỏ mục cũ nhất
// (thứ tự chèn của Map). KHÔNG BAO GIỜ lưu mã gốc. Mỗi bản API có bộ nhớ đệm riêng (provider của
// AuthModule) → thu hồi có hiệu lực ngay trên bản xử lý yêu cầu, ≤ 60 giây trên bản khác.
// HẠN CHẾ: `evict`/`evictWhere` chỉ cho core/auth/** và modules/account/internal/auth/**
// (quy tắc ranh giới `account-scope-restricted`).

export const SESSION_CACHE_TTL_MS = 60_000;
export const SESSION_CACHE_MAX_ENTRIES = 10_000;

interface Entry {
  actor: Actor;
  expiresAt: number;
}

@Injectable()
export class SessionCache {
  private readonly entries = new Map<string, Entry>();
  /** Đồng hồ (ms) – kiểm thử thay bằng đồng hồ giả. */
  now: () => number = Date.now;
  /** Tuổi tối đa và số mục tối đa (kiểm thử được đổi). */
  ttlMs = SESSION_CACHE_TTL_MS;
  maxEntries = SESSION_CACHE_MAX_ENTRIES;

  private static key(tokenHash: Buffer): string {
    return tokenHash.toString('hex');
  }

  /** Người gọi còn trong bộ nhớ đệm, hoặc undefined (hết hạn thì bỏ luôn). */
  get(tokenHash: Buffer): Actor | undefined {
    const key = SessionCache.key(tokenHash);
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.actor;
  }

  /** Lưu người gọi; hết hạn = min(bây giờ + 60 giây, hết hạn tuyệt đối của phiên). */
  set(tokenHash: Buffer, actor: Actor, absoluteExpiresAt: Date): void {
    const key = SessionCache.key(tokenHash);
    const expiresAt = Math.min(this.now() + this.ttlMs, absoluteExpiresAt.getTime());
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { actor, expiresAt });
  }

  /** Bỏ mục của một mã phiên (đăng xuất, thu hồi trên bản API này). */
  evict(tokenHash: Buffer): void {
    this.entries.delete(SessionCache.key(tokenHash));
  }

  /** Bỏ mọi mục thỏa điều kiện (vd mọi phiên của một người dùng). */
  evictWhere(predicate: (actor: Actor) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(entry.actor)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
