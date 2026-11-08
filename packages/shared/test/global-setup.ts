import { execSync } from 'node:child_process';

// Build gói trước khi kiểm thử để so sánh được bản ESM và bản CJS trong dist (T012).
export default function setup(): void {
  execSync('pnpm exec tsup --silent', { stdio: 'inherit' });
}
