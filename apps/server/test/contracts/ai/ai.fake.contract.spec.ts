import { beforeAll, describe } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { describeAiGatewayContract } from './ai-gateway.contract';
import { makeAiHarness, type AiHarness } from './harness';

// 005 T051: Cổng AI – bản giả lập, kho `memory` (pnpm test). SC-003: ≥ 100 vòng × 20 lời gọi.

let harness: AiHarness;
beforeAll(async () => {
  harness = await makeAiHarness('memory', () => Promise.resolve(uuidV7()));
});

describe('Cổng AI – bản giả lập (memory)', () => {
  describeAiGatewayContract(() => harness, { concurrencyRounds: 100, callsPerRound: 25 });
});
