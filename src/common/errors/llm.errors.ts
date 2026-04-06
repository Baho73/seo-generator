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
