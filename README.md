# SEO Product Description Generator

NestJS-сервис для генерации SEO-описаний товаров через LangChain.js + OpenRouter.

## Стек

- **NestJS** — фреймворк
- **LangChain.js** — LCEL-цепочки (ChatPromptTemplate -> ChatOpenAI -> StringOutputParser)
- **Zod** — строгая валидация structured output от LLM
- **OpenRouter API** — провайдер LLM-моделей (OpenAI-совместимый)

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
  "keywords": ["кроссовки", "Nike", "Air Max", "спортивная обувь", "амортизация"]
}
```

**Response (SSE stream):**

Стримит частичные чанки в формате SSE (`text/event-stream`). Каждый event содержит `data:` с JSON:

```
data: {"chunk":"Куп","partial":"Купить"}

data: {"done":true,"result":{...}}
```

Финальный event содержит `done: true` и валидированный Zod-схемой результат:

```json
{
  "title": "Купить кроссовки Nike Air Max 90 — спортивная обувь",
  "meta_description": "Закажите Nike Air Max 90 с воздушной амортизацией. Отличный выбор для спорта и города. Доставка и примерка!",
  "h1": "Кроссовки Nike Air Max 90",
  "description": "Подробное текстовое описание...",
  "bullets": [
    "Технология Air Max для идеальной амортизации",
    "Дышащий текстильный верх с кожаными вставками",
    "Прочная гибкая подошва"
  ]
}
```

### Обработка ошибок

| Ситуация | SSE error event | HTTP (non-stream) |
|----------|----------------|-------------------|
| Невалидный запрос | — | 400 |
| Пустой ответ LLM | `EMPTY_RESPONSE` | 502 |
| Невалидный JSON от LLM (после retry) | `INVALID_JSON` | 502 |
| Таймаут 30с | `LLM_TIMEOUT` | 504 |

При ошибках во время стриминга ошибка отправляется как последний SSE event с полем `error`.

## Тесты

```bash
npm test
```

22 теста: 7 (Zod-схема) + 9 (сервис: парсинг/валидация) + 6 (контроллер: валидация DTO + SSE).

## Flowise

Импортируйте `flowise/seo-chatflow.json` в Flowise для визуальной версии того же пайплайна:

```
Prompt Template -> ChatOpenAI -> Structured Output Parser -> LLM Chain
```

## Архитектура

```
POST /api/generate-seo
  -> ValidationPipe (class-validator DTO)
    -> GenerateController (SSE headers, async iteration)
      -> GenerateService.generateSeoStream()
        -> ChatPromptTemplate (system + user prompts)
          -> ChatOpenAI (OpenRouter, streaming: true)
            -> StringOutputParser (yields chunks)
        -> parseAndValidate() — Zod schema validation
        -> Retry on invalid JSON (1 retry)
      <- AsyncGenerator<{ data: string }> (SSE events)
```

### Prompt Engineering

Системный промпт задаёт роль SEO-копирайтера со строгими ограничениями:
- `title` — строго <=60 символов, кликабельный, с основным ключевым словом
- `meta_description` — строго <=160 символов, продающий, с CTA
- `h1` — отличный от title, содержит основной keyword
- `description` — >=300 символов, keyword density 1-3%
- `bullets` — 3-5 УТП товара

Ограничения дублируются в Zod-схеме: если LLM нарушает лимиты, ответ отклоняется и идёт автоматический retry.

### Обоснование выбора параметров

- **temperature: 0.7** — баланс между креативностью и следованием инструкциям. Ниже — шаблонные тексты, выше — риск нарушения лимитов.
- **Retry: 1 повтор** — достаточно для исправления случайных ошибок парсинга, не замедляет ответ при системных проблемах.
- **Timeout: 30с** — покрывает генерацию ~1000 токенов с запасом на network latency.
- **StringOutputParser + ручной JSON-парсинг** — вместо `withStructuredOutput`, т.к. позволяет стримить частичный текст клиенту в реальном времени.
