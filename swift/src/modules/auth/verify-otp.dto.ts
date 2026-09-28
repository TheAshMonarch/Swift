import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '../../common/email';

export class VerifyOtpDto {
  // Emails are lowercased; phone numbers pass through untouched.
  @Transform(({ value }) => (typeof value === 'string' && value.includes('@') ? normalizeEmail(value) : value))
  @IsString()
  @IsNotEmpty()
  phoneOrEmail!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
