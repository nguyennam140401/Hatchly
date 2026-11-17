import { STEP_LABELS_VI, type StepView } from '@app/shared/publishing';
import { formatDateTime } from '../../lib/format/datetime';
import { StepRow, type StepRowProps } from '../../ui/steps/StepRow';

/** Trạng thái bước của máy chủ → khuôn `StepRow` của hệ thống thiết kế. */
export function stepRowProps(step: StepView): StepRowProps {
  const title = `${String(step.stepNo)}. ${STEP_LABELS_VI[step.key]}`;
  const time = step.at === null ? undefined : formatDateTime(step.at);
  const first = step.remedies[0]?.labelVi;
  switch (step.state) {
    case 'succeeded':
      return { state: 'done', title, ...(time !== undefined ? { time } : {}), ...note(step) };
    case 'not_applicable':
      return { state: 'done', title, explanation: step.note ?? 'Không áp dụng cho kênh này' };
    case 'failed':
      return {
        state: 'error',
        title,
        ...(time !== undefined ? { time } : {}),
        ...(step.messageVi !== null ? { explanation: step.messageVi } : {}),
        ...(first !== undefined ? { remedy: first } : {}),
      };
    case 'running':
      // "Đang thực hiện" bằng CHỮ, không chỉ chuyển động (người giảm chuyển động vẫn thấy).
      return { state: 'pending', running: true, title };
    case 'skipped':
      return { state: 'pending', title, explanation: 'Chưa chạy vì bước trước chưa xong' };
    case 'not_run':
      return { state: 'pending', title };
  }
}

function note(step: StepView): { explanation?: string } {
  return step.note === null ? {} : { explanation: step.note };
}

/** Dòng thời gian 5 bước: DỌC ở màn hình hẹp (360 px), 5 cột từ 768 px. */
export function StepTimeline({ steps, label }: { steps: StepView[]; label: string }) {
  return (
    <ol
      aria-label={label}
      className="flex flex-col divide-y divide-line md:grid md:grid-cols-5 md:gap-2 md:divide-y-0"
    >
      {steps.map((s) => (
        <li key={s.key} className="min-w-0">
          <StepRow {...stepRowProps(s)} />
        </li>
      ))}
    </ol>
  );
}
