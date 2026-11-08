import { bindAccountToRequest } from '../../core/context/bind-account';

// Vi phạm: module nghiệp vụ tự đặt accountId (FR-004).
bindAccountToRequest('x');
export const c = 1;
