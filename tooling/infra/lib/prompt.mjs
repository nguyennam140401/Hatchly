// Hỏi đáp trên dòng lệnh: xác nhận gõ lại tên môi trường, nhập bí mật không hiện chữ.
import { createInterface } from 'node:readline';

/** Hỏi một câu, trả về dòng người dùng gõ (đã cắt khoảng trắng hai đầu). */
export function ask(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    rl.on('close', () => resolve(''));
  });
}

/** Xác nhận bằng cách gõ lại đúng `expected` (vd tên môi trường). */
export async function confirmByTyping(expected, message, io = {}) {
  const typed = await (io.ask ?? ask)(`${message}\nGõ lại "${expected}" để tiếp tục: `);
  return typed === expected;
}

/** Hỏi y/N; mặc định N. */
export async function confirmYesNo(message, io = {}) {
  const answer = await (io.ask ?? ask)(`${message} [y/N] `);
  return /^y(es)?$/i.test(answer);
}

/**
 * Đọc một dòng KHÔNG hiện chữ (bí mật). Cần terminal tương tác; qua đường ống thì từ chối để bí mật không vô tình
 * đi qua lịch sử lệnh hay tệp.
 */
export function askHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    if (input.isTTY !== true) {
      reject(new Error('Nhập bí mật cần terminal tương tác (không đọc từ đường ống hay tham số).'));
      return;
    }
    output.write(question);
    const chars = [];
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          output.write('\n');
          resolve(chars.join(''));
          return;
        }
        if (ch === '\u0003') {
          input.setRawMode(false);
          reject(new Error('Đã hủy.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') chars.pop();
        else chars.push(ch);
      }
    };
    input.on('data', onData);
  });
}
