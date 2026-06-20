import { IsEmail, IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    firstName: string;

    @IsString()
    @IsOptional()
    lastName: string;

    @IsString()
    @IsOptional()
    phoneNumber: string;

    @IsString()
    @IsOptional()
    avatar: string;

    @IsString()
    @IsOptional()
    bio: string;

    @IsArray()
    @IsOptional()
    skills: string[];

    @IsString()
    @IsOptional()
    location: string;

    @IsString()
    @IsOptional()
    city: string;

    @IsString()
    @IsOptional()
    state: string;

    @IsNumber()
    @IsOptional()
    latitude: number;

    @IsNumber()
    @IsOptional()
    longitude: number;

    @IsNumber()
    @IsOptional()
    hourlyRate: number;

    @IsArray()
    @IsOptional()
    serviceCategories: string[];

    @IsOptional()
    bankDetails: {
        accountName: string;
        accountNumber: string;
        bankCode: string;
        bankName: string;
    };

    @IsOptional()
    isFeatured?: boolean;
}
