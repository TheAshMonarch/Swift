import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RejectKycDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}