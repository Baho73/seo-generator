# SEO Product Description Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless NestJS service that generates SEO product descriptions via LangChain.js + OpenRouter with Zod-validated structured output and SSE streaming.

**Architecture:** Single NestJS module with a controller handling `POST /api/generate-seo`, a service wrapping a LangChain LCEL chain (PromptTemplate → ChatOpenAI → StructuredOutputParser). The chain calls OpenRouter, validates output with Zod, streams partial JSON via SSE. A separate Flowise chatflow JSON is provided for import.

**Tech Stack:** Node.js 20+, NestJS 10, LangChain.js, Zod, OpenRouter API (OpenAI-compatible), Jest

---

## File Structure

```
seo-generator/
├── src/
│   ├── main.ts                          — Bootstrap, SSE setup, global pipes
│   ├── app.module.ts                    — Root module
│   ├── generate/
│   │   ├── generate.module.ts           — Module declaration
│   │   ├── generate.controller.ts       — POST /api/generate-seo, SSE streaming
│   │   ├── generate.service.ts          — LangChain LCEL chain, OpenRouter call, retry logic
│   │   ├── dto/
│   │   │   └── generate-seo.dto.ts      — Request DTO with class-validator
│   │   └── schemas/
│   │       └── seo-output.schema.ts     — Zod schema for LLM output
│   ├── prompts/
│   │   └── seo-system.prompt.ts         — System prompt + user prompt templates
│   └── common/
│       ├── filters/
│       │   └── llm-exception.filter.ts  — Global exception filter for LLM errors
│       └── errors/
│           └── llm.errors.ts            — Custom error classes (timeout, empty, invalid JSON)
├── test/
│   ├── generate.service.spec.ts         — Unit tests for chain logic, parsing, retry
│   ├── generate.controller.spec.ts      — Integration tests for endpoint, SSE, errors
│   └── seo-output.schema.spec.ts        — Zod schema validation tests
├── flowise/
│   └── seo-chatflow.json                — Exportable Flowise chatflow
├── .env.example                         — Environment variable template
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
└── README.md
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.env.example`, `src/main.ts`, `src/app.module.ts`

- [ ] **Step 1: Initialize NestJS project**

```bash
cd D:/Python/SEO_generator
npx @nestjs/cli new . --skip-git --package-manager npm --language TypeScript
```

Select `npm` when prompted.

- [ ] **Step 2: Install dependencies**

```bash
npm install @langchain/core @langchain/openai langchain zod class-validator class-transformer dotenv
npm install -D @types/node
```

- [ ] **Step 3: Create `.env.example`**

```env
OPENROUTER_API_KEY=sk-or-...
PORT=3000
```

- [ ] **Step 4: Update `src/main.ts` for validation and prefix**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import 'dotenv/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 5: Verify it compiles**

Run: `npx nest build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold NestJS project with LangChain and Zod deps"
git push
```

---

### Task 2: Zod Schema for SEO Output

**Files:**
- Create: `src/generate/schemas/seo-output.schema.ts`
- Create: `test/seo-output.schema.spec.ts`

- [ ] **Step 1: Write the Zod schema tests**

```typescript
// test/seo-output.schema.spec.ts
import { seoOutputSchema } from '../src/generate/schemas/seo-output.schema';

describe('seoOutputSchema', () => {
  const validOutput = {
    title: 'Купить кроссовки Nike Air Max 90',
    meta_description:
      'Закажите кроссовки Nike Air Max 90 с воздушной амортизацией. Доставка!',
    h1: 'Кроссовки Nike Air Max 90',
    description:
      'Подробное описание товара с ключевыми характеристиками. '.repeat(10),
    bullets: [
      'Технология Air Max',
      'Дышащий верх',
      'Прочная подошва',
    ],
  };

  it('should accept valid SEO output', () => {
    const result = seoOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('should reject title longer than 60 chars', () => {
    const result = seoOutputSchema.safeParse({
      ...validOutput,
      title: 'A'.repeat(61),
    });
    expect(result.success).toBe(false);
  });

  it('should reject meta_description longer than 160 chars', () => {
    const result = seoOutputSchema.safeParse({
      ...validOutput,
      meta_description: 'A'.repeat(161),
    });
    expect(result.success).toBe(false);
  });

  it('should reject fewer than 3 bullets', () => {
    const result = seoOutputSchema.safeParse({
      ...validOutput,
      bullets: ['One', 'Two'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject more than 5 bullets', () => {
    const result = seoOutputSchema.safeParse({
      ...validOutput,
      bullets: ['1', '2', '3', '4', '5', '6'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject description shorter than 300 chars', () => {
    const result = seoOutputSchema.safeParse({
      ...validOutput,
      description: 'Too short',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const { title, ...noTitle } = validOutput;
    const result = seoOutputSchema.safeParse(noTitle);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/seo-output.schema.spec.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the Zod schema**

```typescript
// src/generate/schemas/seo-output.schema.ts
import { z } from 'zod';

export const seoOutputSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(60)
    .describe('SEO title, clickable, up to 60 characters'),
  meta_description: z
    .string()
    .min(1)
    .max(160)
    .describe('Selling meta description, up to 160 characters'),
  h1: z
    .string()
    .min(1)
    .describe('Main heading for the product page'),
  description: z
    .string()
    .min(300)
    .describe('Detailed product description, at least 300 characters'),
  bullets: z
    .array(z.string().min(1))
    .min(3)
    .max(5)
    .describe('3-5 key product benefits as bullet points'),
});

export type SeoOutput = z.infer<typeof seoOutputSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/seo-output.schema.spec.ts --no-cache`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generate/schemas/ test/seo-output.schema.spec.ts
git commit -m "feat: add Zod schema for SEO output with validation constraints"
git push
```

---

### Task 3: Custom Error Classes

**Files:**
- Create: `src/common/errors/llm.errors.ts`

- [ ] **Step 1: Write custom error classes**

```typescript
// src/common/errors/llm.errors.ts
export class LlmTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmEmptyResponseError extends Error {
  constructor() {
    super('LLM returned an empty response');
    this.name = 'LlmEmptyResponseError';
  }
}

export class LlmInvalidJsonError extends Error {
  constructor(
    public readonly rawResponse: string,
    public readonly parseError: string,
  ) {
    super(`LLM returned invalid JSON: ${parseError}`);
    this.name = 'LlmInvalidJsonError';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/common/errors/
git commit -m "feat: add custom LLM error classes (timeout, empty, invalid JSON)"
git push
```

---

### Task 4: Exception Filter for LLM Errors

**Files:**
- Create: `src/common/filters/llm-exception.filter.ts`

- [ ] **Step 1: Write the exception filter**

```typescript
// src/common/filters/llm-exception.filter.ts
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
```

- [ ] **Step 2: Register filter in `main.ts`**

Add to `bootstrap()` after `useGlobalPipes`:

```typescript
import { LlmExceptionFilter } from './common/filters/llm-exception.filter';

// inside bootstrap(), after useGlobalPipes:
app.useGlobalFilters(new LlmExceptionFilter());
```

- [ ] **Step 3: Commit**

```bash
git add src/common/filters/ src/main.ts
git commit -m "feat: add global exception filter for LLM errors"
git push
```

---

### Task 5: Prompt Templates

**Files:**
- Create: `src/prompts/seo-system.prompt.ts`

- [ ] **Step 1: Write prompt templates**

```typescript
// src/prompts/seo-system.prompt.ts
export const SEO_SYSTEM_PROMPT = `You are a world-class SEO copywriter and e-commerce specialist.
Your task is to generate a complete SEO-optimized product description package.

STRICT RULES you MUST follow:
1. "title" — a clickable SEO title. STRICTLY 60 characters or fewer. Include the main keyword naturally.
2. "meta_description" — a selling meta description. STRICTLY 160 characters or fewer. Include a call-to-action and at least one keyword.
3. "h1" — the main heading for the product page. Must contain the primary keyword. Must differ from the title.
4. "description" — a detailed, structured product description. MUST be at least 300 characters. Use the provided keywords organically (keyword density 1-3%). Write compelling copy that sells.
5. "bullets" — exactly 3 to 5 key product benefits as a bullet list. Each bullet should be concise and highlight a unique selling point.

LANGUAGE: Write in the same language as the product name provided.

IMPORTANT:
- Count characters carefully for title and meta_description limits.
- Do NOT exceed the character limits under any circumstances.
- Return ONLY a valid JSON object with the exact fields: title, meta_description, h1, description, bullets.`;

export const SEO_USER_PROMPT_TEMPLATE = `Generate an SEO description package for the following product:

Product Name: {product_name}
Category: {category}
Keywords: {keywords}

Return a JSON object with fields: title, meta_description, h1, description, bullets.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/
git commit -m "feat: add SEO system and user prompt templates"
git push
```

---

### Task 6: Request DTO

**Files:**
- Create: `src/generate/dto/generate-seo.dto.ts`

- [ ] **Step 1: Write the DTO**

```typescript
// src/generate/dto/generate-seo.dto.ts
import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';

export class GenerateSeoDto {
  @IsString()
  @IsNotEmpty()
  product_name: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  keywords: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/generate/dto/
git commit -m "feat: add GenerateSeoDto with class-validator decorators"
git push
```

---

### Task 7: Generate Service — LangChain LCEL Chain

**Files:**
- Create: `src/generate/generate.service.ts`
- Create: `test/generate.service.spec.ts`

- [ ] **Step 1: Write unit tests for the service**

```typescript
// test/generate.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { GenerateService } from '../src/generate/generate.service';
import { ConfigModule } from '@nestjs/config';

// Mock LangChain ChatOpenAI
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    bind: jest.fn().mockReturnThis(),
    pipe: jest.fn().mockReturnThis(),
  })),
}));

describe('GenerateService', () => {
  let service: GenerateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [
            () => ({
              OPENROUTER_API_KEY: 'test-key',
            }),
          ],
        }),
      ],
      providers: [GenerateService],
    }).compile();

    service = module.get<GenerateService>(GenerateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseAndValidate', () => {
    const validJson = JSON.stringify({
      title: 'Test Title',
      meta_description: 'Test meta description for the product page.',
      h1: 'Test H1 Heading',
      description: 'D'.repeat(300),
      bullets: ['Bullet 1', 'Bullet 2', 'Bullet 3'],
    });

    it('should parse valid JSON string and validate against schema', () => {
      const result = service.parseAndValidate(validJson);
      expect(result.title).toBe('Test Title');
      expect(result.bullets).toHaveLength(3);
    });

    it('should extract JSON from markdown code block', () => {
      const wrapped = '```json\n' + validJson + '\n```';
      const result = service.parseAndValidate(wrapped);
      expect(result.title).toBe('Test Title');
    });

    it('should throw LlmEmptyResponseError for empty string', () => {
      expect(() => service.parseAndValidate('')).toThrow('empty');
    });

    it('should throw LlmInvalidJsonError for broken JSON', () => {
      expect(() => service.parseAndValidate('{broken')).toThrow('invalid');
    });

    it('should throw LlmInvalidJsonError when schema validation fails', () => {
      const invalidJson = JSON.stringify({
        title: 'A'.repeat(61), // exceeds 60
        meta_description: 'ok',
        h1: 'ok',
        description: 'short',
        bullets: ['one'],
      });
      expect(() => service.parseAndValidate(invalidJson)).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/generate.service.spec.ts --no-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```typescript
// src/generate/generate.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Observable, Subject } from 'rxjs';
import { seoOutputSchema, SeoOutput } from './schemas/seo-output.schema';
import {
  SEO_SYSTEM_PROMPT,
  SEO_USER_PROMPT_TEMPLATE,
} from '../prompts/seo-system.prompt';
import {
  LlmTimeoutError,
  LlmEmptyResponseError,
  LlmInvalidJsonError,
} from '../common/errors/llm.errors';
import { GenerateSeoDto } from './dto/generate-seo.dto';

const LLM_TIMEOUT_MS = 30_000;

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly model: ChatOpenAI;
  private readonly prompt: ChatPromptTemplate;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'openai/gpt-4o',
      openAIApiKey: process.env.OPENROUTER_API_KEY,
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
   * Parse raw LLM text, extract JSON, validate with Zod.
   * Public for testing.
   */
  parseAndValidate(raw: string): SeoOutput {
    if (!raw || raw.trim().length === 0) {
      throw new LlmEmptyResponseError();
    }

    // Extract JSON from potential markdown code blocks
    let jsonStr = raw.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in text
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
      throw new LlmInvalidJsonError(
        raw,
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    return result.data;
  }

  /**
   * Generate SEO description with SSE streaming.
   * Returns an Observable that emits SSE MessageEvents.
   */
  generateSeoStream(
    dto: GenerateSeoDto,
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    this.executeChain(dto, subject).catch((error) => {
      subject.error(error);
    });

    return subject.asObservable();
  }

  private async executeChain(
    dto: GenerateSeoDto,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    const chain = this.prompt.pipe(this.model).pipe(new StringOutputParser());

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, LLM_TIMEOUT_MS);

    let fullText = '';
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;
      fullText = '';

      try {
        const stream = await chain.stream(
          {
            product_name: dto.product_name,
            category: dto.category,
            keywords: dto.keywords.join(', '),
          },
          { signal: abortController.signal },
        );

        for await (const chunk of stream) {
          fullText += chunk;
          subject.next({
            data: JSON.stringify({ chunk, partial: fullText }),
          } as MessageEvent);
        }

        clearTimeout(timeout);

        // Parse and validate the complete response
        const validated = this.parseAndValidate(fullText);

        // Emit the final validated result
        subject.next({
          data: JSON.stringify({ done: true, result: validated }),
        } as MessageEvent);

        subject.complete();
        return;
      } catch (error) {
        clearTimeout(timeout);

        if (error instanceof LlmEmptyResponseError || error instanceof LlmInvalidJsonError) {
          if (attempt < maxAttempts) {
            this.logger.warn(
              `Attempt ${attempt} failed: ${error.message}. Retrying...`,
            );
            continue;
          }
        }

        if (abortController.signal.aborted) {
          throw new LlmTimeoutError(LLM_TIMEOUT_MS);
        }

        throw error;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/generate.service.spec.ts --no-cache`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generate/generate.service.ts test/generate.service.spec.ts
git commit -m "feat: implement GenerateService with LangChain LCEL chain, Zod validation, retry"
git push
```

---

### Task 8: Generate Controller — SSE Endpoint

**Files:**
- Create: `src/generate/generate.controller.ts`
- Create: `src/generate/generate.module.ts`
- Modify: `src/app.module.ts`
- Create: `test/generate.controller.spec.ts`

- [ ] **Step 1: Write integration tests for the controller**

```typescript
// test/generate.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { LlmExceptionFilter } from '../src/common/filters/llm-exception.filter';
import { GenerateService } from '../src/generate/generate.service';
import { of, throwError } from 'rxjs';
import { LlmTimeoutError } from '../src/common/errors/llm.errors';

describe('GenerateController (e2e)', () => {
  let app: INestApplication;
  let generateService: GenerateService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new LlmExceptionFilter());
    await app.init();

    generateService = moduleFixture.get<GenerateService>(GenerateService);
  });

  afterEach(async () => {
    await app.close();
  });

  const validBody = {
    product_name: 'Test Product',
    category: 'Test Category',
    keywords: ['test', 'product'],
  };

  it('should return 400 for missing product_name', () => {
    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({ category: 'Cat', keywords: ['k'] })
      .expect(400);
  });

  it('should return 400 for empty keywords array', () => {
    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({ product_name: 'P', category: 'C', keywords: [] })
      .expect(400);
  });

  it('should return 504 on LLM timeout', () => {
    jest
      .spyOn(generateService, 'generateSeoStream')
      .mockReturnValue(throwError(() => new LlmTimeoutError(30000)));

    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send(validBody)
      .expect(504);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/generate.controller.spec.ts --no-cache`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the controller**

```typescript
// src/generate/generate.controller.ts
import { Controller, Post, Body, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GenerateService } from './generate.service';
import { GenerateSeoDto } from './dto/generate-seo.dto';

@Controller('generate-seo')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Post()
  @Sse()
  generate(@Body() dto: GenerateSeoDto): Observable<MessageEvent> {
    return this.generateService.generateSeoStream(dto);
  }
}
```

- [ ] **Step 4: Write the module**

```typescript
// src/generate/generate.module.ts
import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';

@Module({
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
```

- [ ] **Step 5: Update `app.module.ts`**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerateModule } from './generate/generate.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GenerateModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest test/generate.controller.spec.ts --no-cache`
Expected: Validation tests PASS, timeout test PASS.

- [ ] **Step 7: Commit**

```bash
git add src/generate/generate.controller.ts src/generate/generate.module.ts src/app.module.ts test/generate.controller.spec.ts
git commit -m "feat: add GenerateController with SSE streaming endpoint POST /api/generate-seo"
git push
```

---

### Task 9: Flowise Chatflow Export

**Files:**
- Create: `flowise/seo-chatflow.json`

- [ ] **Step 1: Create the Flowise chatflow JSON**

This is a Flowise-importable chatflow with three nodes:
1. **Prompt Template** — with variables `{product_name}`, `{category}`, `{keywords}`
2. **ChatOpenAI** — connected to OpenRouter (or direct OpenAI)
3. **Structured Output Parser** — parsing to `{ title, meta_description, h1, description, bullets }`

```json
{
  "nodes": [
    {
      "id": "promptTemplate_0",
      "position": { "x": 100, "y": 300 },
      "type": "customNode",
      "data": {
        "id": "promptTemplate_0",
        "label": "Prompt Template",
        "name": "promptTemplate",
        "type": "PromptTemplate",
        "category": "Prompts",
        "inputs": {
          "template": "You are a world-class SEO copywriter. Generate an SEO description package for:\n\nProduct: {product_name}\nCategory: {category}\nKeywords: {keywords}\n\nReturn a JSON object with fields:\n- title (max 60 chars, clickable SEO title)\n- meta_description (max 160 chars, selling meta description with CTA)\n- h1 (main heading, must contain primary keyword, differ from title)\n- description (detailed product description, min 300 chars, keyword density 1-3%)\n- bullets (array of 3-5 key product benefits)\n\nSTRICTLY follow character limits. Return ONLY valid JSON.",
          "format_instructions": "{format_instructions}"
        },
        "inputParams": [
          {
            "label": "Template",
            "name": "template",
            "type": "string",
            "rows": 6
          }
        ],
        "inputAnchors": [
          {
            "label": "Format Instructions",
            "name": "format_instructions",
            "type": "string",
            "optional": true
          }
        ],
        "outputAnchors": [
          {
            "name": "output",
            "label": "Output",
            "type": "PromptTemplate"
          }
        ]
      }
    },
    {
      "id": "chatOpenAI_0",
      "position": { "x": 500, "y": 100 },
      "type": "customNode",
      "data": {
        "id": "chatOpenAI_0",
        "label": "ChatOpenAI",
        "name": "chatOpenAI",
        "type": "ChatOpenAI",
        "category": "Chat Models",
        "inputs": {
          "modelName": "gpt-4o",
          "temperature": "0.7",
          "maxTokens": "",
          "topP": "",
          "streaming": true
        },
        "credential": "chatOpenAI_api_key",
        "inputParams": [
          { "label": "Model Name", "name": "modelName", "type": "string" },
          { "label": "Temperature", "name": "temperature", "type": "number" }
        ],
        "inputAnchors": [],
        "outputAnchors": [
          { "name": "output", "label": "Output", "type": "ChatOpenAI" }
        ]
      }
    },
    {
      "id": "structuredOutputParser_0",
      "position": { "x": 100, "y": 100 },
      "type": "customNode",
      "data": {
        "id": "structuredOutputParser_0",
        "label": "Structured Output Parser",
        "name": "structuredOutputParser",
        "type": "StructuredOutputParser",
        "category": "Output Parsers",
        "inputs": {
          "jsonStructure": "{\n  \"title\": \"SEO title, max 60 characters\",\n  \"meta_description\": \"Meta description, max 160 characters\",\n  \"h1\": \"Main heading for product page\",\n  \"description\": \"Detailed product description, min 300 characters\",\n  \"bullets\": \"Array of 3-5 key product benefits\"\n}"
        },
        "inputParams": [
          {
            "label": "JSON Structure",
            "name": "jsonStructure",
            "type": "string",
            "rows": 8
          }
        ],
        "inputAnchors": [],
        "outputAnchors": [
          {
            "name": "output",
            "label": "Output",
            "type": "StructuredOutputParser"
          }
        ]
      }
    },
    {
      "id": "llmChain_0",
      "position": { "x": 500, "y": 400 },
      "type": "customNode",
      "data": {
        "id": "llmChain_0",
        "label": "LLM Chain",
        "name": "llmChain",
        "type": "LLMChain",
        "category": "Chains",
        "inputs": {
          "inputVariables": "product_name,category,keywords"
        },
        "inputParams": [],
        "inputAnchors": [
          {
            "label": "Language Model",
            "name": "model",
            "type": "BaseChatModel"
          },
          {
            "label": "Prompt",
            "name": "prompt",
            "type": "BasePromptTemplate"
          },
          {
            "label": "Output Parser",
            "name": "outputParser",
            "type": "BaseLLMOutputParser",
            "optional": true
          }
        ],
        "outputAnchors": [
          { "name": "output", "label": "Output", "type": "LLMChain" }
        ]
      }
    }
  ],
  "edges": [
    {
      "source": "chatOpenAI_0",
      "sourceHandle": "chatOpenAI_0-output-chatOpenAI-ChatOpenAI",
      "target": "llmChain_0",
      "targetHandle": "llmChain_0-input-model-BaseChatModel"
    },
    {
      "source": "promptTemplate_0",
      "sourceHandle": "promptTemplate_0-output-promptTemplate-PromptTemplate",
      "target": "llmChain_0",
      "targetHandle": "llmChain_0-input-prompt-BasePromptTemplate"
    },
    {
      "source": "structuredOutputParser_0",
      "sourceHandle": "structuredOutputParser_0-output-structuredOutputParser-StructuredOutputParser",
      "target": "llmChain_0",
      "targetHandle": "llmChain_0-input-outputParser-BaseLLMOutputParser"
    },
    {
      "source": "structuredOutputParser_0",
      "sourceHandle": "structuredOutputParser_0-output-structuredOutputParser-StructuredOutputParser",
      "target": "promptTemplate_0",
      "targetHandle": "promptTemplate_0-input-format_instructions-string"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add flowise/
git commit -m "feat: add Flowise chatflow JSON export (PromptTemplate + ChatOpenAI + StructuredOutputParser)"
git push
```

---

### Task 10: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
# SEO Product Description Generator

NestJS-сервис для генерации SEO-описаний товаров через LangChain.js + OpenRouter.

## Стек

- **NestJS** — фреймворк
- **LangChain.js** — LCEL цепочки для LLM
- **Zod** — валидация structured output
- **OpenRouter API** — провайдер LLM моделей

## Запуск

```bash
npm install
cp .env.example .env
# Заполните OPENROUTER_API_KEY в .env
npm run start:dev
```

## API

### `POST /api/generate-seo`

Генерация SEO-описания товара с SSE-стримингом.

**Request:**

```json
{
  "product_name": "Кроссовки Nike Air Max 90",
  "category": "Обувь / Спортивная обувь",
  "keywords": ["кроссовки", "Nike", "Air Max", "спортивная обувь"]
}
```

**Response (SSE stream):**

Стримит частичные чанки, финальный event содержит `{ done: true, result: {...} }` с валидированным JSON:

```json
{
  "title": "Купить кроссовки Nike Air Max 90 — спортивная обувь",
  "meta_description": "Закажите Nike Air Max 90 с воздушной амортизацией...",
  "h1": "Кроссовки Nike Air Max 90",
  "description": "Подробное описание...",
  "bullets": ["Технология Air Max", "Дышащий верх", "Прочная подошва"]
}
```

### Обработка ошибок

| Код | Ошибка | Описание |
|-----|--------|----------|
| 400 | Validation Error | Невалидный запрос |
| 502 | EMPTY_RESPONSE | Пустой ответ от LLM |
| 502 | INVALID_JSON | LLM вернул невалидный JSON (после retry) |
| 504 | LLM_TIMEOUT | Таймаут 30с |

## Тесты

```bash
npm test
```

## Flowise

Импортируйте `flowise/seo-chatflow.json` в Flowise для визуальной версии пайплайна.

## Архитектура

```
POST /api/generate-seo
  → GenerateController (SSE)
    → GenerateService
      → ChatPromptTemplate (system + user prompts)
        → ChatOpenAI (OpenRouter)
          → StringOutputParser (streaming chunks)
      → Zod validation (seoOutputSchema)
      → Retry on invalid JSON (1 attempt)
```

### Prompt Engineering

Системный промпт задаёт роль SEO-копирайтера и строгие ограничения:
- title ≤ 60 символов
- meta_description ≤ 160 символов
- description ≥ 300 символов
- 3-5 bullets
- Органичное вписывание keywords (density 1-3%)

Ограничения по длине дублируются в Zod-схеме — если LLM нарушает лимиты, ответ отклоняется и делается повторная попытка.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with API docs, architecture, and setup instructions"
git push
```

---

### Task 11: Final Integration Test — Manual Smoke

- [ ] **Step 1: Build the project**

Run: `npx nest build`
Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Manual smoke test with curl**

```bash
# Start the server
npm run start:dev

# In another terminal:
curl -X POST http://localhost:3000/api/generate-seo \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Кроссовки Nike Air Max 90","category":"Обувь","keywords":["кроссовки","Nike","Air Max"]}'
```

Expected: SSE stream of chunks, final event with validated JSON result.

- [ ] **Step 4: Test validation error**

```bash
curl -X POST http://localhost:3000/api/generate-seo \
  -H "Content-Type: application/json" \
  -d '{"category":"Обувь","keywords":["test"]}'
```

Expected: 400 with validation error (missing product_name).

- [ ] **Step 5: Final commit and push**

```bash
git add -A
git status
# If any uncommitted changes:
git commit -m "chore: final cleanup"
git push
```
