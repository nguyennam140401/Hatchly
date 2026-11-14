// Chạy tiến trình con KHÔNG qua shell (chạy được trên Windows và Linux, không bị tiêm lệnh qua đối số).
import { spawn } from 'node:child_process';

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string,string|undefined>, input?: string|Buffer, inherit?: boolean }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 *   `inherit: true` cho đầu ra đi thẳng ra màn hình (stdout/stderr trả về rỗng).
 *   Không bao giờ ném lỗi vì mã thoát khác 0; ném khi không chạy được tệp (vd thiếu công cụ).
 */
export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: options.inherit === true ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Kiểm tra một lệnh có chạy được không (vd `terraform version`). */
export async function commandExists(command, args = ['--version']) {
  try {
    const result = await run(command, args);
    return result.code === 0;
  } catch {
    return false;
  }
}
