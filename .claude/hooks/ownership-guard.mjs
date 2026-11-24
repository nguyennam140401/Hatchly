#!/usr/bin/env node
// PreToolUse cho Write/Edit/MultiEdit/NotebookEdit.
// Chặn (exit 2) khi agent ghi tệp ngoài phạm vi trong .specify/ownership.json.
// Hiểu worktree .claude/worktrees/<NNN>/. An toàn mở nếu thiếu cấu hình hoặc không nhận diện agent.
import { readInput, locate, loadOwnership, matches, deny as _deny } from "./lib.mjs";

const input = readInput();
const agent = input.agent_type || input.agent || "";
const target = input.tool_input?.file_path || input.tool_input?.notebook_path || "";
if (!agent || !target) process.exit(0);

const loc = locate(input, target);
const fail = (msg, rel) => _deny("ownership-guard", `Agent "${agent}" bị chặn ghi ${rel ?? target}. ${msg} Báo PM (KẾT QUẢ: bị-chặn) để giao đúng chủ sở hữu.`);
if (!loc) fail("Đường dẫn nằm ngoài dự án.");

const cfg = loadOwnership(loc.root, loc.main);
if (!cfg) process.exit(0);
const rule = cfg.agents?.[agent];
if (!rule) process.exit(0); // agent không nằm trong bảng: không quản
const rel = loc.rel;

if (matches(cfg.always_deny, rel) && !matches(cfg.always_deny_except, rel)) fail("Tệp thuộc danh sách luôn cấm.", rel);

// Phiên đang ở worktree mà ghi vào repo chính: chỉ cho trạng thái PM.
if (loc.crossCheckout && !rel.startsWith(".specify/pm/state/")) {
  fail("Đây là repo chính trong khi phiên đang làm ở worktree. Ghi vào checkout của tính năng (ROOT).", rel);
}

const isShared = matches(cfg.shared_sequential, rel);
const inScope = matches(rule.write, rel) && !matches(rule.exclude, rel);

if (isShared) {
  if (rule.may_write_shared || inScope) process.exit(0);
  fail("Tệp dùng chung chỉ dev được ghi, và chỉ khi nhiệm vụ gắn [SHARED].", rel);
}
if (!inScope) fail("Không thuộc phạm vi ghi của agent này (xem .specify/ownership.json).", rel);

if (!rule.wins_conflicts) {
  for (const [name, other] of Object.entries(cfg.agents)) {
    if (name !== agent && other.wins_conflicts && matches(other.write, rel) && !matches(other.exclude, rel)) {
      fail(`Tệp này thuộc "${name}" (quy tắc thắng xung đột).`, rel);
    }
  }
}
process.exit(0);
