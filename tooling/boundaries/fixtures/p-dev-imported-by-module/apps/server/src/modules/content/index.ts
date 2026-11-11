// Vi phạm: mã chạy production của module nhập mã chỉ-dev.
import { memoryTx } from '../../dev/memory-tx';
import { store } from './internal/fake/store';

export const c = [memoryTx(), store];
