import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES, type ErrorResponse } from '@app/shared/core';
import type { Request, Response } from 'express';
import { resolveTraceId } from '../context/request-context';
import { DbConnectionError, DbPolicyViolationError, TenantContextError } from '../db/errors';
import { AppError } from './app-error';

type ErrorBody = ErrorResponse['error'];
type Mapped = Omit<ErrorBody, 'support'> & { status: number; detail?: string };

const RETRY = { kind: 'retry', label: 'Thử lại' } as const;
const CONTACT = { kind: 'contact_support', label: 'Liên hệ hỗ trợ' } as const;

function fromHttpException(err: HttpException): Mapped {
  const status = err.getStatus();
  if (status === 404) {
    return {
      status,
      code: ERROR_CODES.NOT_FOUND,
      message: 'Không tìm thấy nội dung bạn yêu cầu.',
      actions: [{ kind: 'navigate', label: 'Về trang chủ', href: '/' }],
    };
  }
  if (status === 503) {
    return {
      status,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
      actions: [RETRY],
    };
  }
  if (status >= 400 && status < 500) {
    // Vd thân yêu cầu không phải JSON hợp lệ, quá lớn.
    return {
      status,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại.',
      actions: [{ kind: 'fix_input', label: 'Sửa thông tin' }],
      detail: `HTTP_${status}`,
    };
  }
  return internal();
}

function internal(): Mapped {
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Đã có lỗi xảy ra. Vui lòng thử lại; nếu vẫn lỗi, hãy liên hệ hỗ trợ.',
    actions: [RETRY, CONTACT],
  };
}

/**
 * Bộ lọc ngoại lệ toàn cục: mọi lỗi → `ErrorResponse` (contracts/http-api.md).
 * Lỗi 500 không bao giờ chứa stack trace, SQL hay giá trị cấu hình – chi tiết kỹ thuật chỉ vào
 * nhật ký kỹ thuật, gắn cùng `trace_id`.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const traceId = resolveTraceId(req, res);

    let mapped: Mapped;
    if (exception instanceof AppError) {
      mapped = {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        actions: exception.actions,
        ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
        ...(exception.detail !== undefined ? { detail: exception.detail } : {}),
      };
    } else if (
      exception instanceof TenantContextError ||
      exception instanceof DbPolicyViolationError
    ) {
      // Lỗi lập trình của lớp CSDL: khách hàng thấy lỗi chung, mã gốc chỉ ở "Chi tiết cho hỗ trợ".
      mapped = { ...internal(), detail: exception.code };
    } else if (exception instanceof DbConnectionError) {
      mapped = {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
        actions: [RETRY],
        detail: exception.code,
      };
    } else if (exception instanceof HttpException) {
      mapped = fromHttpException(exception);
    } else {
      mapped = internal();
    }

    if (mapped.status >= 500 && !(exception instanceof AppError)) {
      // Lỗi CSDL đã chuẩn hóa không chứa SQL/tham số/chuỗi kết nối (R15).
      this.logger.error({ msg: 'request.unhandled_error', err: exception, trace_id: traceId });
    }

    const { status, detail, ...rest } = mapped;
    const body: ErrorResponse = {
      error: { ...rest, support: { traceId, ...(detail !== undefined ? { detail } : {}) } },
    };
    res.status(status).json(body);
  }
}
