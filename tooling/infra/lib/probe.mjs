// Đo gián đoạn: gọi một địa chỉ mỗi giây và in số giây gián đoạn DÀI NHẤT (T081, SC-007).
// Dùng: node tooling/infra/lib/probe.mjs https://api.<miền>/healthz [số giây, mặc định 300]
import { pathToFileURL } from 'node:url';

/**
 * @param {{ url: string, seconds?: number, intervalMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
 * @returns {Promise<{ samples: number, failures: number, longestOutageSeconds: number }>}
 */
export async function probe({
  url,
  seconds = 300,
  intervalMs = 1000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  const end = now() + seconds * 1000;
  let samples = 0;
  let failures = 0;
  let outageStart = null;
  let longestMs = 0;
  while (now() < end) {
    let good = false;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(Math.max(intervalMs, 2000)),
      });
      good = response.ok;
    } catch {
      good = false;
    }
    samples += 1;
    const t = now();
    if (good) {
      if (outageStart !== null) longestMs = Math.max(longestMs, t - outageStart);
      outageStart = null;
    } else {
      failures += 1;
      outageStart ??= t;
    }
    await sleep(intervalMs);
  }
  if (outageStart !== null) longestMs = Math.max(longestMs, now() - outageStart);
  return { samples, failures, longestOutageSeconds: Math.round(longestMs / 100) / 10 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, seconds] = process.argv.slice(2);
  if (url === undefined) {
    console.error('Dùng: node tooling/infra/lib/probe.mjs <url> [số giây]');
    process.exit(1);
  }
  const result = await probe({ url, seconds: Number(seconds ?? 300) });
  console.log(
    `Mẫu: ${result.samples} · lỗi: ${result.failures} · gián đoạn dài nhất: ${result.longestOutageSeconds} giây`,
  );
}
