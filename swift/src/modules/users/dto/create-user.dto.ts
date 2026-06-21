import { IsEmail, IsString, MinLength, IsNotEmpty, IsEnum, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LocationDto {
	@IsArray()
	@IsNumber({}, { each: true })
	coordinates!: [number, number]; // Strictly [longitude, latitude]
}

export class ProProfileDto {
	@IsString()
	@IsNotEmpty()
	category!: string;

	@IsArray()
	@IsString({ each: true })
	skills!: string[];

	@IsNumber()
	hourlyRate!: number;
}

export class CreateUserDto {
	@IsString()
	@IsNotEmpty()
	name!: string;

	@IsEmail()
	email!: string;

	@IsString()
	@MinLength(6)
	password!: string;

	@IsString()
	@IsNotEmpty()
	phone!: string;

	@IsEnum(['seeker', 'professional', 'admin'])
	role!: string;

	@ValidateNested()
	@Type(() => LocationDto)
	location!: LocationDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => ProProfileDto)
	proProfile?: ProProfileDto;

	@IsOptional()
	@IsString()
	googleId?: string;
}