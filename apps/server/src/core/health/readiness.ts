import { Injectable } from '@nestjs/common';

/** Một kiểm tra sẵn sàng (WBS 1.2 thêm CSDL, WBS 1.3 thêm hàng chờ). */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<boolean>;
}

/** Sổ đăng ký kiểm tra sẵn sàng; ban đầu rỗng → `/readyz` trả `ready`. */
@Injectable()
export class ReadinessRegistry {
  private readonly checks: ReadinessCheck[] = [];

  register(check: ReadinessCheck): void {
    this.checks.push(check);
  }

  async run(): Promise<{ name: string; status: 'pass' | 'fail' }[]> {
    return Promise.all(
      this.checks.map(async (c) => {
        try {
          return { name: c.name, status: (await c.check()) ? 'pass' : 'fail' } as const;
        } catch {
          return { name: c.name, status: 'fail' } as const;
        }
      }),
    );
  }
}
