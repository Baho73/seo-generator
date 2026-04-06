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
