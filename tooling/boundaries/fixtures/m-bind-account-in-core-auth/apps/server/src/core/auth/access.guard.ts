import { bindAccountToRequest } from '../context/bind-account';

// Hợp lệ: guard là nơi duy nhất trong core/auth được gắn tài khoản.
bindAccountToRequest('x');
export const g = 1;
