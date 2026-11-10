import { hash, verify, type Options } from '@node-rs/argon2';

// Bọc @node-rs/argon2 (R2, nguyên tắc VII/IX – không tự viết mật mã): argon2id, tham số là cấu hình.
// Chuỗi kết quả là định dạng PHC `$argon2id$v=19$m=…,t=…,p=…$…`.

/** Argon2id = 2 trong `Algorithm` (const enum – không nhập được dưới isolatedModules). */
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- const enum, xem chú thích trên
const ARGON2ID = 2 as NonNullable<Options['algorithm']>;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
}

export class PasswordHasher {
  private readonly options: Options;
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly params: Argon2Params) {
    this.options = {
      algorithm: ARGON2ID,
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: 1,
    };
  }

  /** Băm mật khẩu ĐÃ chuẩn hóa NFKC (password-policy). */
  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  /** So mật khẩu với băm; băm hỏng → false (không ném). */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Băm dùng tham số khác cấu hình hiện tại → nên băm lại khi đăng nhập thành công. */
  needsRehash(passwordHash: string): boolean {
    const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
    if (m === null) return true;
    return (
      Number(m[1]) !== this.params.memoryCost ||
      Number(m[2]) !== this.params.timeCost ||
      Number(m[3]) !== 1
    );
  }

  /**
   * Chạy verify trên một băm giả cố định – cân thời gian khi email không tồn tại/không có mật khẩu
   * (FR-006, SC-006). Luôn trả false.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('mat-khau-gia-de-can-thoi-gian');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
