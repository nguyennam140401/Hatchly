#!/usr/bin/env node
// PreToolUse cho Read và Grep: agent không được đọc tệp .env* (trừ .env.example/.sample/.template).
// Hiến chương VII: bí mật không xuất hiện ngoài kho bí mật. Chỉ áp dụng cho agent có tên (không chặn phiên thường).
import { readInput, norm, deny } from "./lib.mjs";

const input = readInput();
const agent = input.agent_type || input.agent || "";
if (!agent) process.exit(0);

const ti = input.tool_input || {};
const isExample = (b) => /\.(example|sample|template)$/i.test(b);
const baseOf = (p) => norm(p).split("/").pop();

// Đường dẫn cụ thể (Read.file_path, Grep.path)
for (const p of [ti.file_path, ti.path].filter(Boolean)) {
  const b = baseOf(p);
  if (/^\.env(\..+)?$/.test(b) && !isExample(b)) {
    deny("env-guard", `Agent "${agent}" không được đọc ${p} (chứa bí mật). Dùng .env.example để biết tên biến; cần giá trị thật thì báo PM để người dùng tự cung cấp.`);
  }
}
// Mẫu glob của Grep, ví dụ ".env*" hoặc "**/.env.local"
if (ti.glob) {
  const b = baseOf(ti.glob);
  if (b.startsWith(".env") && !/(example|sample|template)/i.test(b)) {
    deny("env-guard", `Agent "${agent}" không được tìm trong ${ti.glob} (tệp .env chứa bí mật).`);
  }
}
process.exit(0);
