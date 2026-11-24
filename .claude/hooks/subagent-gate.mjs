#!/usr/bin/env node
// SubagentStop: cổng cuối cho agent thi công. Chạy các kiểm tra nhanh mà hiến chương bắt buộc ở CI:
//   - quét bí mật (pnpm check:secrets) cho mọi agent thi công
//   - ranh giới module (pnpm check:boundaries) cho backend-dev và data-dev
// Đỏ thì exit 2 để agent tự sửa trước khi kết thúc. Chỉ chặn một lần (stop_hook_active) và an toàn mở
// nếu không có pnpm hoặc hết thời gian. Kiểm tra nặng (typecheck, lint, test, verify) để reviewer/qa/PM chạy.
import { spawnSync } from "node:child_process";
import { readInput, deny } from "./lib.mjs";

const input = readInput();
const agent = input.agent_type || input.agent || "";
if (input.stop_hook_active) process.exit(0);

const PLAN = {
  "backend-dev": ["check:secrets", "check:boundaries"],
  "data-dev": ["check:secrets", "check:boundaries"],
  "frontend-dev": ["check:secrets"],
  "devops-dev": ["check:secrets"],
  "qa": ["check:secrets"],
};
const scripts = PLAN[agent];
if (!scripts) process.exit(0);

const cwd = input.cwd || process.cwd();
const TIMEOUT = Number(process.env.PM_GATE_TIMEOUT_MS || 180000);
for (const s of scripts) {
  const r = spawnSync("pnpm", [s], { cwd, shell: true, encoding: "utf8", timeout: TIMEOUT });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const missing = r.error || r.status === null || r.status === 127 ||
    /is not recognized as an internal or external command|command not found|ENOENT|Missing script/i.test(out);
  if (missing) continue; // an toàn mở
  if (r.status !== 0) {
    const tail = out.trim().split(/\r?\n/).slice(-20).join("\n");
    deny("subagent-gate", `"pnpm ${s}" thất bại sau công việc của ${agent}. Sửa rồi kết thúc lại:\n${tail}`);
  }
}
process.exit(0);
