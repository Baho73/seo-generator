import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
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
  }

  /**
   * Parse raw LLM text output, extract JSON, validate with Zod.
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
   * Stream SEO generation via LangChain LCEL chain.
   * Yields SSE-formatted chunks, ends with validated JSON result.
   */
  async *generateSeoStream(
    dto: GenerateSeoDto,
  ): AsyncGenerator<{ data: string }> {
    const chain = this.prompt
      .pipe(this.model)
      .pipe(new StringOutputParser());

    const input = {
      product_name: dto.product_name,
      category: dto.category,
      keywords: dto.keywords.join(', '),
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        LLM_TIMEOUT_MS,
      );

      let fullText = '';

      try {
        const stream = await chain.stream(input, {
          signal: abortController.signal,
        });

        for await (const chunk of stream) {
          fullText += chunk;
          yield { data: JSON.stringify({ chunk }) };
        }

        clearTimeout(timeout);

        // Validate complete response
        const validated = this.parseAndValidate(fullText);
        yield { data: JSON.stringify({ done: true, result: validated }) };
        return;
      } catch (error) {
        clearTimeout(timeout);

        if (abortController.signal.aborted) {
          throw new LlmTimeoutError(LLM_TIMEOUT_MS);
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
            // Signal client to discard previous chunks
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

    // All retries exhausted
    if (lastError) {
      throw lastError;
    }
  }
}
