#!/usr/bin/env node
// PreToolUse cho Bash.
// - Mọi agent có tên: cấm đọc .env* qua lệnh shell.
// - Agent con (khác pm): cấm git ghi (commit, push, merge, checkout, stash, worktree add/remove...),
//   docker compose up/run/start, và lệnh áp dụng hạ tầng thật (terraform apply/destroy, kubectl apply/delete, helm install/upgrade).
// pm được miễn phần git/hạ tầng vì skill worktree của dự án chạy lệnh git qua Bash của PM.
import { readInput, deny } from "./lib.mjs";

const input = readInput();
const agent = input.agent_type || input.agent || "";
const cmd = String(input.tool_input?.command || "");
if (!agent || !cmd) process.exit(0);

// 1. Đọc .env qua shell
const envRe = /(^|[\s"'`/\\=<>|;&(])(\.env(?:\.[\w.-]+)?)(?=$|[\s"'`;|&)<>])/g;
for (const m of cmd.matchAll(envRe)) {
  if (!/\.(example|sample|template)$/i.test(m[2])) {
    deny("bash-guard", `Agent "${agent}" không được đụng ${m[2]} (chứa bí mật). Dùng .env.example hoặc báo PM.`);
  }
}
if (agent === "pm") process.exit(0);

// 2. git: chỉ cho lệnh chỉ đọc
const READ_GIT = new Set(["status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "rev-list", "blame", "grep", "describe", "cat-file", "shortlog", "merge-base", "diff-tree", "name-rev"]);
const gitRe = /\bgit(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-[pP]))*\s+([a-z][a-z-]*)([^|;&\n]*)/g;
for (const m of cmd.matchAll(gitRe)) {
  const sub = m[1], rest = m[2] || "";
  let ok = READ_GIT.has(sub);
  // git branch chỉ được liệt kê: sau khi bỏ các cờ chỉ đọc thì không còn đối số nào.
  if (sub === "branch") ok = rest.replace(/--show-current|--list|-[alrv]+(?=\s|$)/g, "").trim() === "";
  if (sub === "worktree") ok = /^\s+list\b/.test(rest);
  if (!ok) deny("bash-guard", `Agent "${agent}" không được chạy "git ${sub}". Commit, merge, đổi nhánh và worktree do PM và người dùng quyết (speckit-worktree-finish). Báo PM nếu cần.`);
}

// 3. docker compose
if (/\bdocker(?:-|\s+)compose\b[^|;&\n]*\b(up|start|run|restart)\b/.test(cmd)) {
  deny("bash-guard", `Agent "${agent}" không được chạy docker compose up/run/start (trùng cổng 3000/3001/8080 khi có hai checkout). Dùng "pnpm db:up" nếu chỉ cần cơ sở dữ liệu, hoặc báo PM.`);
}

// 4. Áp dụng hạ tầng thật
const infraRe = /\b(terraform|tofu)\b[^|;&\n]*\b(apply|destroy|import|state\s+(rm|mv))\b|\bkubectl\b[^|;&\n]*\b(apply|delete|replace|patch|scale|rollout|drain|cordon)\b|\bhelm\b[^|;&\n]*\b(install|upgrade|uninstall|rollback)\b|\binfra\b[^|;&\n]*\b(apply|destroy)\b/;
if (infraRe.test(cmd)) {
  deny("bash-guard", `Agent "${agent}" không được áp dụng thay đổi lên hạ tầng thật. Chỉ plan/validate/lint. Ghi lệnh vào "CẦN NGƯỜI DÙNG TỰ CHẠY" để người dùng tự chạy.`);
}
process.exit(0);
