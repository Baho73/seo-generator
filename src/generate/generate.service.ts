import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import {
  SEO_SYSTEM_PROMPT,
  SEO_USER_PROMPT_TEMPLATE,
} from '../prompts/seo-system.prompt';
import { seoOutputSchema, SeoOutput } from './schemas/seo-output.schema';
import {
  LlmTimeoutError,
  LlmEmptyResponseError,
  LlmInvalidJsonError,
} from '../common/errors/llm.errors';
import { GenerateSeoDto } from './dto/generate-seo.dto';

const LLM_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly model: ChatOpenAI;
  private readonly prompt: ChatPromptTemplate;
  /** LCEL chain: prompt → model.withStructuredOutput(Zod) — uses function calling */
  private readonly structuredChain: Runnable;
  /** Fallback LCEL chain: prompt → model → StringOutputParser — for text streaming */
  private readonly streamingChain: Runnable;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill in your key.',
      );
    }
    const modelName =
      this.configService.get<string>('OPENROUTER_MODEL') ?? 'openai/gpt-4o';

    this.model = new ChatOpenAI({
      modelName,
      apiKey,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
      temperature: 0.7,
      streaming: true,
    });

    this.prompt = ChatPromptTemplate.fromMessages([
      ['system', SEO_SYSTEM_PROMPT],
      ['human', SEO_USER_PROMPT_TEMPLATE],
    ]);

    // Primary: function calling with Zod schema validation
    this.structuredChain = this.prompt.pipe(
      this.model.withStructuredOutput(seoOutputSchema),
    );

    // Fallback: text streaming with manual JSON extraction
    this.streamingChain = this.prompt
      .pipe(this.model)
      .pipe(new StringOutputParser());
  }

  /**
   * Parse raw LLM text output, extract JSON, validate with Zod.
   * Used as fallback when structured output is unavailable.
   * Public for unit testing.
   */
  parseAndValidate(raw: string): SeoOutput {
    if (!raw || raw.trim().length === 0) {
      throw new LlmEmptyResponseError();
    }

    let jsonStr = raw.trim();

    // Extract JSON from markdown code blocks
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Find JSON object in surrounding text
    if (!jsonStr.startsWith('{')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new LlmInvalidJsonError(raw, (e as Error).message);
    }

    const result = seoOutputSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new LlmInvalidJsonError(raw, issues);
    }

    return result.data;
  }

  /**
   * Generate SEO description using structured output (function calling).
   * Primary method — Zod schema is enforced by the LLM provider via tool/function call.
   * Falls back to text streaming + manual parsing if structured output fails.
   */
  async *generateSeoStream(
    dto: GenerateSeoDto,
    signal?: AbortSignal,
  ): AsyncGenerator<{ data: string }> {
    const input = {
      product_name: dto.product_name,
      category: dto.category,
      keywords: dto.keywords.join(', '),
    };

    // Attempt 1: Structured Output via function calling (preferred)
    try {
      yield* this.generateWithStructuredOutput(input, signal);
      return;
    } catch (error) {
      this.logger.warn(
        `Structured output failed: ${(error as Error).message}. Falling back to text streaming.`,
      );
    }

    // Attempt 2: Fallback to text streaming + manual JSON parsing
    yield* this.generateWithTextStream(input, signal);
  }

  /**
   * Primary path: uses model.withStructuredOutput(zodSchema)
   * which leverages function calling / structured outputs API.
   */
  private async *generateWithStructuredOutput(
    input: Record<string, string>,
    signal?: AbortSignal,
  ): AsyncGenerator<{ data: string }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);

    // Combine external signal (client disconnect) with timeout
    if (signal) {
      signal.addEventListener('abort', () => abortController.abort());
    }

    try {
      const result: SeoOutput = await this.structuredChain.invoke(input, {
        signal: abortController.signal,
      });

      clearTimeout(timeout);

      // Validate with Zod (belt and suspenders — LLM should already conform)
      const validated = seoOutputSchema.safeParse(result);
      if (!validated.success) {
        const issues = validated.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new LlmInvalidJsonError(JSON.stringify(result), issues);
      }

      yield { data: JSON.stringify({ done: true, result: validated.data }) };
    } catch (error) {
      clearTimeout(timeout);
      if (abortController.signal.aborted && !signal?.aborted) {
        throw new LlmTimeoutError(LLM_TIMEOUT_MS);
      }
      throw error;
    }
  }

  /**
   * Fallback path: streams raw text chunks via SSE, then validates
   * the accumulated response with Zod. Retries once on invalid JSON.
   */
  private async *generateWithTextStream(
    input: Record<string, string>,
    signal?: AbortSignal,
  ): AsyncGenerator<{ data: string }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        LLM_TIMEOUT_MS,
      );

      if (signal) {
        signal.addEventListener('abort', () => abortController.abort());
      }

      let fullText = '';

      try {
        const stream = await this.streamingChain.stream(input, {
          signal: abortController.signal,
        });

        for await (const chunk of stream) {
          fullText += chunk;
          yield { data: JSON.stringify({ chunk }) };
        }

        clearTimeout(timeout);

        const validated = this.parseAndValidate(fullText);
        yield { data: JSON.stringify({ done: true, result: validated }) };
        return;
      } catch (error) {
        clearTimeout(timeout);

        if (abortController.signal.aborted && !signal?.aborted) {
          throw new LlmTimeoutError(LLM_TIMEOUT_MS);
        }
        if (signal?.aborted) {
          throw error;
        }

        if (
          error instanceof LlmEmptyResponseError ||
          error instanceof LlmInvalidJsonError
        ) {
          lastError = error;
          if (attempt < MAX_RETRIES) {
            this.logger.warn(
              `Attempt ${attempt} failed: ${error.message}. Retrying...`,
            );
            yield {
              data: JSON.stringify({
                retry: true,
                attempt: attempt + 1,
                reason: error.message,
              }),
            };
            continue;
          }
        }

        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }
  }
}
