import { authTx } from '../../core/db/auth-tx';

// Vi phạm: module nghiệp vụ mở giao dịch không tenant (004, R4).
void authTx(async () => 1);
export const c = 1;
