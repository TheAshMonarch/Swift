import { IsOptional, IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class UpdateLocationDto {
  @IsArray()
  @IsNumber({}, { each: true })
  coordinates!: [number, number];
}

class UpdateProProfileDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsNumber() hourlyRate?: number;
}

export class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLocationDto)
  location?: UpdateLocationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProProfileDto)
  proProfile?: UpdateProProfileDto;
}