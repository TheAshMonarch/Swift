import { IsNotEmpty, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LocationDto } from './register.dto';

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto; // Optional fallback if browser permissions are turned off

  @IsOptional()
  @IsString()
  role?: string; // Captures whether they clicked 'seeker' or 'professional'
}