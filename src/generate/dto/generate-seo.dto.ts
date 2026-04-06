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
