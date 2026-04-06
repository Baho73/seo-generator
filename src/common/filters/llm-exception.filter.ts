import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  LlmTimeoutError,
  LlmEmptyResponseError,
  LlmInvalidJsonError,
} from '../errors/llm.errors';

@Catch(LlmTimeoutError, LlmEmptyResponseError, LlmInvalidJsonError)
export class LlmExceptionFilter implements ExceptionFilter {
  catch(
    exception: LlmTimeoutError | LlmEmptyResponseError | LlmInvalidJsonError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof LlmTimeoutError) {
      response.status(HttpStatus.GATEWAY_TIMEOUT).json({
        error: 'LLM_TIMEOUT',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof LlmEmptyResponseError) {
      response.status(HttpStatus.BAD_GATEWAY).json({
        error: 'EMPTY_RESPONSE',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof LlmInvalidJsonError) {
      response.status(HttpStatus.BAD_GATEWAY).json({
        error: 'INVALID_JSON',
        message: exception.message,
        raw_response: exception.rawResponse,
      });
      return;
    }
  }
}
