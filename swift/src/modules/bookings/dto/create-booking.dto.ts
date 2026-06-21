import { IsString, IsNotEmpty, IsNumber, Min, IsMongoId } from 'class-validator';

export class CreateBookingDto {
  @IsMongoId()
  professionalId!: string;

  @IsString()
  @IsNotEmpty()
  serviceDescription!: string;

  @IsNumber()
  @Min(100) // minimum ₦100
  agreedAmountNaira!: number;
}