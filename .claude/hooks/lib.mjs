// Thư viện dùng chung cho các hook. Mọi hook an toàn mở: lỗi bất ngờ thì cho qua.
import fs from "node:fs";
import path from "node:path";

export function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

export function norm(p) { return String(p || "").replace(/\\/g, "/"); }
const isAbs = (p) => /^([A-Za-z]:)?\//.test(p);
export function abs(p, base) {
  p = norm(p);
  if (!isAbs(p)) p = norm(base || process.cwd()) + "/" + p;
  return path.posix.normalize(p);
}
const WIN = process.platform === "win32";
const cmpKey = (p) => (WIN ? p.toLowerCase() : p);

export function toRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else { re += ".*"; }
      } else { re += "[^/]*"; }
    } else if (c === "?") { re += "[^/]"; }
    else { re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); }
  }
  return new RegExp("^" + re + "$", WIN ? "i" : "");
}

// Mẫu không chứa "/" khớp theo tên tệp ở mọi cấp (ví dụ package.json trong monorepo).
export function matches(globs, rel) {
  const base = rel.split("/").pop();
  return (globs || []).some((g) => (g.includes("/") ? toRegex(g).test(rel) : toRegex(g).test(base)));
}

// Xác định gốc checkout, gốc repo chính và đường dẫn tương đối của một tệp,
// có hiểu worktree .claude/worktrees/<NNN>/.
export function locate(input, target) {
  const cwd = abs(input.cwd || process.cwd(), process.cwd());
  const proj = abs(process.env.CLAUDE_PROJECT_DIR || cwd, cwd);
  const t = abs(target, cwd);
  const WT = /^(.*?)\/\.claude\/worktrees\/([^/]+)(?:\/(.*))?$/i;

  const mt = t.match(WT);
  const mp = proj.match(WT);
  const main = mp ? mp[1] : proj;
  const projIsWorktree = !!mp;
  const projRoot = mp ? `${mp[1]}/.claude/worktrees/${mp[2]}` : proj;

  if (mt && mt[3] !== undefined) {
    return { rel: mt[3], root: `${mt[1]}/.claude/worktrees/${mt[2]}`, main: mt[1], projIsWorktree, crossCheckout: false };
  }
  for (const root of [projRoot, main]) {
    if (cmpKey(t).startsWith(cmpKey(root) + "/")) {
      return {
        rel: t.slice(root.length + 1), root, main, projIsWorktree,
        crossCheckout: projIsWorktree && root === main,
      };
    }
  }
  return null;
}

export function loadOwnership(...roots) {
  for (const r of roots) {
    try { return JSON.parse(fs.readFileSync(path.join(r, ".specify", "ownership.json"), "utf8")); } catch { /* thử gốc kế */ }
  }
  return null;
}

export function deny(tag, msg) {
  process.stderr.write(`[${tag}] ${msg}\n`);
  process.exit(2);
}
