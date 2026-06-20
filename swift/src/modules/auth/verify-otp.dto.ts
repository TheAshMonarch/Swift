import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phoneOrEmail!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
