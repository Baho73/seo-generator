import { GenerateService } from '../src/generate/generate.service';

describe('GenerateService', () => {
  let service: GenerateService;

  beforeEach(() => {
    // Bypass constructor's ChatOpenAI initialization for unit tests
    process.env.OPENROUTER_API_KEY = 'test-key';
    service = new GenerateService();
  });

  const validData = {
    title: 'Test Title for SEO Product',
    meta_description: 'Buy this amazing product with fast delivery and great quality.',
    h1: 'Amazing SEO Product',
    description: 'D'.repeat(300),
    bullets: ['Benefit one', 'Benefit two', 'Benefit three'],
  };

  describe('parseAndValidate', () => {
    it('should parse valid JSON string and validate against schema', () => {
      const result = service.parseAndValidate(JSON.stringify(validData));
      expect(result.title).toBe(validData.title);
      expect(result.bullets).toHaveLength(3);
    });

    it('should extract JSON from markdown code block', () => {
      const wrapped = '```json\n' + JSON.stringify(validData) + '\n```';
      const result = service.parseAndValidate(wrapped);
      expect(result.title).toBe(validData.title);
    });

    it('should extract JSON from surrounding text', () => {
      const wrapped = 'Here is the result:\n' + JSON.stringify(validData) + '\nDone!';
      const result = service.parseAndValidate(wrapped);
      expect(result.title).toBe(validData.title);
    });

    it('should throw LlmEmptyResponseError for empty string', () => {
      expect(() => service.parseAndValidate('')).toThrow('empty');
    });

    it('should throw LlmEmptyResponseError for whitespace-only string', () => {
      expect(() => service.parseAndValidate('   \n  ')).toThrow('empty');
    });

    it('should throw LlmInvalidJsonError for broken JSON', () => {
      expect(() => service.parseAndValidate('{broken')).toThrow('invalid');
    });

    it('should throw LlmInvalidJsonError for non-JSON text', () => {
      expect(() => service.parseAndValidate('just some text')).toThrow('invalid');
    });

    it('should throw LlmInvalidJsonError when schema validation fails', () => {
      const invalid = { ...validData, title: 'A'.repeat(61) };
      expect(() => service.parseAndValidate(JSON.stringify(invalid))).toThrow(
        'invalid',
      );
    });

    it('should throw LlmInvalidJsonError when required fields are missing', () => {
      const { title, ...noTitle } = validData;
      expect(() => service.parseAndValidate(JSON.stringify(noTitle))).toThrow(
        'invalid',
      );
    });
  });
});
