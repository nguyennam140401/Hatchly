import { beforeAll, describe } from 'vitest';
import { currentAccountId } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { makeOnCrossed } from '../../../src/modules/ai_gateway/ai_gateway.module';
import { getMemoryEmitter } from '../../../src/modules/notifications/internal/fake';
import { describeAiGatewayContract } from './ai-gateway.contract';
import { makeAiHarness, type AiHarness } from './harness';

// 005 T051: Cổng AI – bản giả lập, kho `memory` (pnpm test). SC-003: ≥ 100 vòng × 20 lời gọi.

let harness: AiHarness;
beforeAll(async () => {
  const emitter = getMemoryEmitter();
  const emitted: { accountId: string; type: string }[] = [];
  harness = await makeAiHarness('memory', () => Promise.resolve(uuidV7()), {
    onCrossed: async (tx, crossed, cycleStart) => {
      await makeOnCrossed(emitter)(tx, crossed, cycleStart);
      // Bộ phát bộ nhớ là hàng chờ: lấy ra đếm (thay cho flush của Thông báo).
      for (const p of emitter.drain()) emitted.push({ accountId: p.accountId, type: p.event.type });
    },
    count: (type) =>
      Promise.resolve(
        emitted.filter((e) => e.accountId === currentAccountId() && e.type === type).length,
      ),
  });
});

describe('Cổng AI – bản giả lập (memory)', () => {
  describeAiGatewayContract(() => harness, { concurrencyRounds: 100, callsPerRound: 25 });
});
