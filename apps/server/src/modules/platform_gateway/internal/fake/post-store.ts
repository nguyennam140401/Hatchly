import type { ConnectionStore } from '../connections/connection-store';

// Phần "nền tảng giả" của kho giả lập: bài đã lên. KHÔNG chặn đăng trùng – hai `submit` cùng dấu tạo hai
// bài, `publishedCount` đếm đúng để bộ kiểm thử lộ được lỗi đăng trùng của luồng gọi.

export type FakePostState = 'processing' | 'published' | 'failed';

export interface FakePost {
  id: string;
  connectionId: string;
  platformPostId: string;
  contentHash: string;
  storedTextHash: string;
  permalink: string;
  state: FakePostState;
  processingId: string | null;
  /** `done_pending` → (lần hỏi 1) `done_ready` → (lần hỏi 2) xong; tương tự `failed_*`. */
  processingOutcome: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export type NewFakePost = Omit<FakePost, 'id' | 'createdAt'>;

export interface FakePostStore {
  insertPost(p: NewFakePost): Promise<FakePost>;
  findByProcessingId(processingId: string): Promise<FakePost | null>;
  updatePost(
    id: string,
    patch: Partial<Pick<FakePost, 'state' | 'processingOutcome' | 'publishedAt'>>,
  ): Promise<void>;
  /** Bài đã lên của kết nối có dấu (tính lại trên chữ nền tảng lưu) khớp, đăng trong [from, to]. */
  findPublishedByStoredHash(
    connectionId: string,
    storedTextHash: string,
    from: Date,
    to: Date,
  ): Promise<FakePost | null>;
  listPosts(connectionId?: string): Promise<FakePost[]>;
  /** Số bài thực sự lên (state = published) mang dấu nội dung này – của tài khoản trong ngữ cảnh. */
  publishedCount(contentHash: string): Promise<number>;
  /** Xóa mọi trạng thái giả của tài khoản trong ngữ cảnh. */
  reset(): Promise<void>;
}

export type FakePlatformStore = ConnectionStore & FakePostStore;
