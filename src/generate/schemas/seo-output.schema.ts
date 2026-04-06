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
