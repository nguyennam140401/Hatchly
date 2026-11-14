// Nối ba lớp chặn (plan-guard) vào `plan` và `apply` (T093, T094). Phần đọc/ghi bản ghi và băm tiêm được để kiểm thử.
import { existsSync } from 'node:fs';
import { CliExit, EXIT } from './exit-codes.mjs';
import {
  definitionHash as defHash,
  gitState,
  paramsHash as parHash,
  shortHash,
} from './definition-hash.mjs';
import { guardDataLoss, guardSavedPlan, guardStagingFirst } from './plan-guard.mjs';
import { confirmByTyping, confirmYesNo } from './prompt.mjs';
import { protectedChanges, protectionRemovals } from './protected-resources.mjs';
import { protectionRemovedAddresses, recordsForHash, writeApplyRecord } from './records.mjs';

const hashes = (env, deps) => ({
  definitionHash: (deps.definitionHash ?? defHash)(),
  paramsHash: (deps.paramsHash ?? parHash)(env),
});

function throwIfBlocked(result) {
  if (!result.ok) {
    throw new CliExit(
      [result.message, ...result.details.map((d) => `  - ${d}`)].join('\n'),
      result.code,
    );
  }
}

/** Lớp (a) chạy TRƯỚC khi lập bản xem trước của production. */
export async function assertStagingFirst(env, deps = {}) {
  if (env !== 'production') return;
  const { definitionHash } = hashes(env, deps);
  const stagingRecords = await (deps.recordsForHash ?? recordsForHash)('staging', definitionHash);
  throwIfBlocked(guardStagingFirst({ env, definitionHash, stagingRecords }));
}

/** Hook cho `planOne`: `meta` có thêm dấu định nghĩa/tham số, `protectedChanges` và `protectionRemoved` để `apply` không phải đọc lại bản xem trước. */
export function planHooksWithChanges(env, deps = {}) {
  let captured = { changes: [], removed: [] };
  return {
    gates: ({ json }) => {
      captured = { changes: protectedChanges(json), removed: protectionRemovals(json) };
      for (const c of captured.changes) {
        console.log(
          `!! ${c.action === 'delete' ? 'XÓA' : 'THAY THẾ'} ${c.address} (tài nguyên chứa dữ liệu – cần quy trình gỡ bảo vệ)`,
        );
      }
      return Promise.resolve();
    },
    meta: async () => ({
      ...hashes(env, deps),
      protectedChanges: captured.changes,
      protectionRemoved: captured.removed,
      stagingRecord:
        env === 'production'
          ? `records/applied/${shortHash(hashes(env, deps).definitionHash)}`
          : null,
    }),
  };
}

/** Hook cho `applyOne`: lớp (b), (a) lại, (c); ghi bản ghi sau khi áp dụng thành công. */
export function applyHooks(env, deps = {}) {
  const ask = deps.confirmByTyping ?? confirmByTyping;
  const yesNo = deps.confirmYesNo ?? confirmYesNo;
  let dataLossConfirmed = false;
  return {
    beforeApply: async ({ stack, planFile, meta, flags }) => {
      const { definitionHash, paramsHash } = hashes(env, deps);
      const git = await (deps.gitState ?? gitState)();
      if (git.dirty.length > 0) {
        throw new CliExit(
          `Cây git không sạch trong infra/ hoặc tooling/infra/:\n  ${git.dirty.slice(0, 10).join('\n  ')}`,
          EXIT.BLOCKED,
        );
      }
      throwIfBlocked(
        guardSavedPlan({
          env,
          planExists: (deps.existsSync ?? existsSync)(planFile),
          meta,
          currentDefinitionHash: definitionHash,
          currentParamsHash: paramsHash,
          now: deps.now?.() ?? new Date(),
        }),
      );
      await assertStagingFirst(env, deps);

      const changes = meta.protectedChanges ?? [];
      if (changes.length > 0) {
        const removed = await (deps.protectionRemovedAddresses ?? protectionRemovedAddresses)(env);
        const confirmFlag = flags?.['confirm-data-loss'] === true;
        const typed =
          env === 'production' && confirmFlag
            ? await ask('production', `Xác nhận có thể MẤT DỮ LIỆU (${stack}).`)
            : false;
        const verdict = guardDataLoss({
          env,
          protectedChanges: changes,
          confirmDataLoss: confirmFlag,
          typedConfirmation: typed,
          protectionRemoved: removed,
        });
        if (verdict.warn === true) {
          console.log(`CẢNH BÁO (thử nghiệm): ${verdict.details.join(', ')}`);
          if (!(await yesNo('Vẫn tiếp tục?'))) throw new CliExit('Đã hủy.', EXIT.BLOCKED);
        } else throwIfBlocked(verdict);
        dataLossConfirmed = verdict.dataLossConfirmed === true;
      }
    },
    afterApply: async ({ stack, meta }) => {
      const git = await (deps.gitState ?? gitState)();
      await (deps.writeApplyRecord ?? writeApplyRecord)(env, {
        stack,
        definitionHash: meta.definitionHash,
        paramsHash: meta.paramsHash,
        gitCommit: git.commit,
        summary: meta.summary,
        dataLossConfirmed,
        protectedChanges: meta.protectedChanges ?? [],
        protectionRemoved: meta.protectionRemoved ?? [],
      });
    },
  };
}
