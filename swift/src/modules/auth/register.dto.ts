import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizeEmail } from '../../common/email';

export class LocationDto {
  // Required data from client -> Use '!'
  @IsArray()
  @IsNumber({}, { each: true })
  coordinates!: number[]; // [longitude, latitude]
}

export class ProProfileDto {
  // Required data from client -> Use '!'
  @IsString()
  @IsNotEmpty()
  category!: string;

  // Required data from client -> Use '!'
  @IsArray()
  @IsString({ each: true })
  skills!: string[];

  // Required data from client -> Use '!'
  @IsNumber()
  hourlyRate!: number;
}

export class RegisterDto {
  // Required data from client -> Use '!'
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Required data from client -> Use '!'
  @Transform(({ value }) => normalizeEmail(value))
  @IsEmail()
  email!: string;

  // Required data from client -> Use '!'
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  // Required data from client -> Use '!'
  @IsString()
  @IsNotEmpty()
  phone!: string;

  // SECURITY: 'admin' must never be registrable from the public API.
  // Admin accounts are provisioned directly in the database / via seed script.
  @IsEnum(['seeker', 'professional'])
  role!: string;

  // Required data from client -> Use '!'
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  // Explicitly marked @IsOptional() -> Keep '?'
  @IsOptional()
  @ValidateNested()
  @Type(() => ProProfileDto)
  proProfile?: ProProfileDto;
}
