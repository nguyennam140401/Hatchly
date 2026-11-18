// Xử lý video (014 R5): `ffprobe` đọc thời lượng/kích thước/góc xoay; `ffmpeg` lấy MỘT khung hình đại diện làm ảnh thu nhỏ.
// Video gốc giữ nguyên, KHÔNG chuyển mã (spec Assumptions). Tiến trình con chạy với `AbortSignal` của việc + thời hạn;
// đối số chỉ có đường dẫn tệp tạm trên đĩa (không URL ký sẵn) nên nhật ký không rò URL (FR-023).
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Lý do không xử lý được video (khớp `failure_code`). */
export type VideoFailure = 'no_video_stream' | 'corrupt';

export class VideoPipelineError extends Error {
  constructor(readonly failure: VideoFailure) {
    super(`Không xử lý được video (${failure})`);
    this.name = 'VideoPipelineError';
  }
}

export interface VideoInfo {
  durationMs: number;
  /** Kích thước HIỂN THỊ (đã tính góc xoay 90°/270°). */
  width: number;
  height: number;
}

export interface ToolOptions {
  signal?: AbortSignal;
  /** Thời hạn tối đa của một lần chạy (mặc định 5 phút). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;

const ffprobeBin = (): string => process.env.FFPROBE_PATH ?? 'ffprobe';
const ffmpegBin = (): string => process.env.FFMPEG_PATH ?? 'ffmpeg';

interface ProbeJson {
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string };
  }[];
  format?: { duration?: string };
}

/** Lỗi do hủy việc (tắt có kiểm soát) phải đi ra ngoài nguyên vẹn, không bị coi là "tệp hỏng". */
function isAbort(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

/** Đọc thông tin video từ tệp trên đĩa. Không có luồng hình ⇒ `no_video_stream`; không đọc được ⇒ `corrupt`. */
export async function probeVideo(file: string, opts: ToolOptions = {}): Promise<VideoInfo> {
  let stdout: string;
  try {
    const r = await run(
      ffprobeBin(),
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height,duration:stream_side_data=rotation:stream_tags=rotate:format=duration',
        '-of',
        'json',
        file,
      ],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    stdout = r.stdout;
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new VideoPipelineError('corrupt');
  }

  let json: ProbeJson;
  try {
    json = JSON.parse(stdout) as ProbeJson;
  } catch {
    throw new VideoPipelineError('corrupt');
  }
  const video = json.streams?.find((s) => s.codec_type === 'video');
  if (video?.width === undefined || video.height === undefined) {
    throw new VideoPipelineError('no_video_stream');
  }
  const rotation = Math.abs(
    Math.round(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        Number(video.tags?.rotate ?? 0),
    ),
  );
  const swap = rotation === 90 || rotation === 270;
  const seconds = Number(json.format?.duration ?? video.duration ?? 0);
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
  };
}

/** Thời điểm lấy khung hình: min(1 giây, 10% thời lượng). */
export function frameSeekSeconds(durationMs: number): number {
  return Math.min(1, (durationMs / 1000) * 0.1);
}

/**
 * Lấy một khung hình đã xoay đúng chiều (ffmpeg tự xoay theo ma trận hiển thị) ra tệp PNG `outFile`.
 * Thử lại một lần từ giây 0 khi khung ở vị trí chọn không có (video rất ngắn / khung đầu hỏng).
 */
export async function extractFrame(
  file: string,
  outFile: string,
  info: VideoInfo,
  opts: ToolOptions = {},
): Promise<void> {
  const attempt = async (seek: number): Promise<boolean> => {
    try {
      await run(
        ffmpegBin(),
        [
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          seek.toFixed(3),
          '-i',
          file,
          '-frames:v',
          '1',
          outFile,
        ],
        {
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (err) {
      if (isAbort(err)) throw err;
      return false;
    }
    try {
      await access(outFile);
      return true;
    } catch {
      return false;
    }
  };

  if (await attempt(frameSeekSeconds(info.durationMs))) return;
  if (await attempt(0)) return;
  throw new VideoPipelineError('corrupt');
}
