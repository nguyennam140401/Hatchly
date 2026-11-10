import { runInAccountScope } from '../../core/auth/account-scope';

// Vi phạm: module nghiệp vụ tự chọn tài khoản (004, R4, nguyên tắc I).
void runInAccountScope('x', async () => 1);
export const c = 1;
