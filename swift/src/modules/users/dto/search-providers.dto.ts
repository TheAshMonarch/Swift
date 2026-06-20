import { IsArray, IsNumber, IsString, IsOptional } from "class-validator";

export class SearchProvidersDto {
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skills?: string[];

    @IsOptional()
    @IsString()
    state?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    serviceCategories?: string[];

    @IsOptional()
    @IsString()
    city?: string;

    @IsOptional()
    @IsNumber()
    latitude?: number;

    @IsOptional()
    @IsNumber()
    longitude?: number;

    @IsOptional()
    @IsNumber()
    minRating?: number;

    @IsOptional()
    @IsNumber()
    maxDistance?: number;
}