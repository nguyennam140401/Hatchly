// Chỉ số của lớp hàng chờ (research R11, contracts/queue-observability.md mục 1, FR-031) qua
// OpenTelemetry API – no-op cho tới khi có SDK (WBS 1.6). Nhãn: `queue` (+ `job_type`, `outcome`,
// `cause`) – KHÔNG BAO GIỜ có `account_id`, `job_id`, `dedupe_key`.
import { metrics, type Attributes, type MeterProvider } from '@opentelemetry/api';
import type { Pool } from 'pg';
import { QUEUE_NAMES, type QueueName } from '../public-api';
import type { PgBoss } from './pgboss/boss-loader';
import { JOB_TABLE } from './producer';

export type FinishOutcome = 'completed' | 'retry' | 'no_retry' | 'dead' | 'aborted' | 'requeued';

interface Snapshot {
  waiting: Map<QueueName, number>;
  oldest: Map<QueueName, number>;
  dead24h: Map<QueueName, number>;
  workersLive: number;
}

const emptySnapshot = (): Snapshot => ({
  waiting: new Map(),
  oldest: new Map(),
  dead24h: new Map(),
  workersLive: 0,
});

export class QueueMetrics {
  private readonly duration;
  private readonly finished;
  private readonly deadCreated;
  private readonly settingsInvalidCounter;
  private readonly unknownTypeCounter;
  private snapshot: Snapshot = emptySnapshot();

  constructor(provider?: MeterProvider) {
    const meter = (provider ?? metrics.getMeterProvider()).getMeter('app.queue');
    // Đơn vị giây ghi trong mô tả, KHÔNG đặt `unit` – tên Prometheus giữ đúng `queue_job_duration_bucket`
    // như quy tắc cảnh báo (ops/alerts/queue.rules.yml), không thêm hậu tố `_seconds`.
    this.duration = meter.createHistogram('queue.job.duration', {
      description: 'Thời gian xử lý một lượt việc (giây)',
      advice: {
        explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 480, 600, 900],
      },
    });
    this.finished = meter.createCounter('queue.jobs.finished', {
      description: 'Số lượt việc kết thúc theo kết quả',
    });
    this.deadCreated = meter.createCounter('queue.dead_jobs.created', {
      description: 'Số việc vào việc hỏng',
    });
    this.settingsInvalidCounter = meter.createCounter('queue.settings.invalid', {
      description: 'Số lần đọc được dòng infra.queue_settings không hợp lệ',
    });
    this.unknownTypeCounter = meter.createCounter('queue.unknown_job_type', {
      description:
        'Số lần gặp loại việc chưa đăng ký ở phía xử lý (vd quay về bản cũ) – việc được trả lại hàng chờ',
    });
    const perQueue =
      (pick: (s: Snapshot) => Map<QueueName, number>) =>
      (result: { observe: (value: number, attributes?: Attributes) => void }) => {
        for (const queue of QUEUE_NAMES)
          result.observe(pick(this.snapshot).get(queue) ?? 0, { queue });
      };
    meter
      .createObservableGauge('queue.jobs.waiting', { description: 'Việc đến giờ đang chờ lấy' })
      .addCallback(perQueue((s) => s.waiting));
    meter
      .createObservableGauge('queue.jobs.oldest_wait_seconds', {
        unit: 's',
        description: 'Tuổi chờ của việc đến giờ lâu nhất chưa được lấy',
      })
      .addCallback(perQueue((s) => s.oldest));
    meter
      .createObservableGauge('queue.dead_jobs.last_24h', { description: 'Việc hỏng trong 24 giờ' })
      .addCallback(perQueue((s) => s.dead24h));
    meter
      .createObservableGauge('queue.workers.live', { description: 'Số bản Worker đang sống' })
      .addCallback((result) => {
        result.observe(this.snapshot.workersLive);
      });
  }

  jobFinished(queue: QueueName, jobType: string, outcome: FinishOutcome, seconds: number): void {
    this.finished.add(1, { queue, job_type: jobType, outcome });
    this.duration.record(seconds, { queue, job_type: jobType, outcome });
  }

  deadJobCreated(queue: QueueName, jobType: string, cause: string): void {
    this.deadCreated.add(1, { queue, job_type: jobType, cause });
  }

  unknownJobType(queue: QueueName, jobType: string): void {
    this.unknownTypeCounter.add(1, { queue, job_type: jobType });
  }

  settingsInvalid(queue: string): void {
    this.settingsInvalidCounter.add(1, { queue });
  }

  /** Cập nhật số liệu cho gauge (mỗi 30 giây) – truy vấn trên bể điều khiển. */
  async refresh(pool: Pool, boss: PgBoss): Promise<void> {
    const next = emptySnapshot();
    const r = await pool.query<{ queue: QueueName; waiting: string; oldest: string | null }>(
      `SELECT name AS queue,
              count(*)::text AS waiting,
              extract(epoch FROM now() - min(start_after))::text AS oldest
         FROM ${JOB_TABLE}
        WHERE name = ANY($1) AND state IN ('created', 'retry') AND start_after <= now()
        GROUP BY name`,
      [[...QUEUE_NAMES]],
    );
    for (const row of r.rows) {
      next.waiting.set(row.queue, Number(row.waiting));
      next.oldest.set(row.queue, Math.max(0, Number(row.oldest ?? 0)));
    }
    const dead = await pool.query<{ queue: QueueName; n: string }>(
      "SELECT queue, n::text AS n FROM infra.count_dead_jobs_since(now() - interval '24 hours')",
    );
    for (const row of dead.rows) next.dead24h.set(row.queue, Number(row.n));
    const instances = await boss.getInstances();
    next.workersLive = instances.filter((i) => i.live && i.name === 'worker').length;
    this.snapshot = next;
  }
}
