import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '../../common/email';

export class LoginDto {
    @Transform(({ value }) => normalizeEmail(value))
    @IsEmail()
    email!: string;

    @IsString()
    @MinLength(6)
    password!: string;
}
