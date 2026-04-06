import { seoOutputSchema } from '../src/generate/schemas/seo-output.schema';

describe('seoOutputSchema', () => {
  const validOutput = {
    title: 'Купить кроссовки Nike Air Max 90',
    meta_description:
      'Закажите кроссовки Nike Air Max 90 с воздушной амортизацией. Доставка!',
    h1: 'Кроссовки Nike Air Max 90',
    description:
      'Подробное описание товара с ключевыми характеристиками. '.repeat(10),
    bullets: ['Технология Air Max', 'Дышащий верх', 'Прочная подошва'],
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
