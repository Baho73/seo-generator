import { Controller, Post, Body, Req, Res, HttpCode, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GenerateService } from './generate.service';
import { GenerateSeoDto } from './dto/generate-seo.dto';
import {
  LlmTimeoutError,
  LlmEmptyResponseError,
  LlmInvalidJsonError,
} from '../common/errors/llm.errors';

@Controller('generate-seo')
export class GenerateController {
  private readonly logger = new Logger(GenerateController.name);

  constructor(private readonly generateService: GenerateService) {}

  @Post()
  @HttpCode(200)
  async generate(
    @Body() dto: GenerateSeoDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Abort LLM call when client disconnects (saves tokens and CPU)
    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        this.logger.log('Client disconnected, aborting LLM stream');
        abortController.abort();
      }
    });

    try {
      const stream = this.generateService.generateSeoStream(
        dto,
        abortController.signal,
      );
      for await (const event of stream) {
        if (abortController.signal.aborted) break;
        res.write(`data: ${event.data}\n\n`);
      }
      res.end();
    } catch (error) {
      if (abortController.signal.aborted) {
        // Client already gone — no point sending error
        res.end();
        return;
      }
      const errorPayload = this.mapErrorToPayload(error);
      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      res.end();
    }
  }

  private mapErrorToPayload(error: unknown): {
    error: string;
    message: string;
    raw_response?: string;
  } {
    if (error instanceof LlmTimeoutError) {
      return { error: 'LLM_TIMEOUT', message: error.message };
    }
    if (error instanceof LlmEmptyResponseError) {
      return { error: 'EMPTY_RESPONSE', message: error.message };
    }
    if (error instanceof LlmInvalidJsonError) {
      return {
        error: 'INVALID_JSON',
        message: error.message,
        raw_response: error.rawResponse,
      };
    }
    return {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
