import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { GenerateModule } from '../src/generate/generate.module';
import { GenerateService } from '../src/generate/generate.service';
import { ConfigModule } from '@nestjs/config';

describe('GenerateController (e2e)', () => {
  let app: INestApplication;

  const mockGenerateService = {
    generateSeoStream: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        GenerateModule,
      ],
    })
      .overrideProvider(GenerateService)
      .useValue(mockGenerateService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

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

  it('should return 400 for missing category', () => {
    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({ product_name: 'P', keywords: ['k'] })
      .expect(400);
  });

  it('should return 400 for non-string keywords', () => {
    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({ product_name: 'P', category: 'C', keywords: [123] })
      .expect(400);
  });

  it('should return 400 for extra fields (forbidNonWhitelisted)', () => {
    return request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({
        product_name: 'P',
        category: 'C',
        keywords: ['k'],
        extra_field: 'not allowed',
      })
      .expect(400);
  });

  it('should stream SSE response for valid input', async () => {
    const mockResult = {
      title: 'Test',
      meta_description: 'Test meta',
      h1: 'Test H1',
      description: 'D'.repeat(300),
      bullets: ['A', 'B', 'C'],
    };

    async function* mockStream() {
      yield { data: JSON.stringify({ chunk: 'partial' }) };
      yield { data: JSON.stringify({ done: true, result: mockResult }) };
    }

    mockGenerateService.generateSeoStream.mockReturnValue(mockStream());

    const response = await request(app.getHttpServer())
      .post('/api/generate-seo')
      .send({
        product_name: 'Test Product',
        category: 'Test Category',
        keywords: ['test'],
      })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('data:');
    expect(response.text).toContain('"done":true');
  });
});
