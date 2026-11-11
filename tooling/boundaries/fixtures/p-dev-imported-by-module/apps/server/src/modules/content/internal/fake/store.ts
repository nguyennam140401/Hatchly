// Được phép: bản giả lập của module dùng src/dev.
import { memoryTx } from '../../../../dev/memory-tx';
import { fakeScenarios } from '../../../../dev/sandbox/schema';

export const store = [memoryTx(), fakeScenarios];
