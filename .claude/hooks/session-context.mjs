#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact): in bản tóm tắt ngắn để PM biết đang ở đâu mà không phải đọc lại gì.
// Nội dung stdout được nạp vào ngữ cảnh. Luôn thoát 0, im lặng nếu lỗi.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readInput } from "./lib.mjs";

const input = readInput();
const cwd = input.cwd || process.cwd();
const git = (...a) => { try { return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { return ""; } };

try {
  const top = git("rev-parse", "--show-toplevel");
  if (!top) process.exit(0);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const wtRaw = git("worktree", "list", "--porcelain");
  const trees = wtRaw.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  const main = trees[0] || top;
  const inWorktree = path.resolve(top) !== path.resolve(main);

  const lines = [];
  lines.push(`[PM] Checkout: ${inWorktree ? "worktree" : "repo chính"} | nhánh: ${branch || "?"} | gốc: ${top}`);
  if (inWorktree) lines.push(`[PM] Repo chính: ${main}`);
  try {
    const f = JSON.parse(fs.readFileSync(path.join(top, ".specify", "feature.json"), "utf8")).feature_directory;
    if (f) lines.push(`[PM] feature.json trỏ tới: ${f}`);
  } catch { /* không có */ }
  lines.push(`[PM] Số worktree: ${Math.max(trees.length - 1, 0)}`);

  const dir = path.join(main, ".specify", "pm", "state");
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort(); } catch { /* chưa có */ }
  const open = [];
  for (const n of files) {
    const t = fs.readFileSync(path.join(dir, n), "utf8");
    const g = (re) => (t.match(re) || [])[1]?.trim();
    const stage = g(/\*\*Giai đoạn:\*\*\s*(.+)/) || "?";
    if (/^xong\b/i.test(stage)) continue;
    const kind = g(/\*\*Loại:\*\*\s*(.+)/) || "?";
    const qs = (t.split(/^## Câu hỏi đang mở\s*$/m)[1] || "").split(/^## /m)[0]
      .split(/\r?\n/).filter((l) => /^\s*-\s+\S/.test(l) && !/trống/i.test(l)).length;
    open.push(`  - ${n.replace(/\.md$/, "")}: ${kind}, giai đoạn ${stage}${qs ? `, ${qs} câu hỏi mở` : ""}`);
  }
  lines.push(open.length ? `[PM] Tính năng đang làm:\n${open.join("\n")}` : "[PM] Không có tính năng đang dở trong .specify/pm/state/.");
  lines.push("[PM] Nhắc: chạy hook worktree ở luồng chính; mỗi lời giao việc có ROOT; chi tiết ở .claude/agents/pm.md.");
  process.stdout.write(lines.join("\n") + "\n");
} catch { /* im lặng */ }
process.exit(0);
