import { bindAccountToRequest } from '../context/bind-account';

// Vi phạm: tệp khác của core/auth tự gắn tài khoản (004 – chỉ access.guard.ts).
bindAccountToRequest('x');
export const h = 1;
