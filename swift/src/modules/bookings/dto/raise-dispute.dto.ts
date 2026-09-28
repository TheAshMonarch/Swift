import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RaiseDisputeDto {
  // Shown to the admin who resolves the dispute
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Describe what went wrong' })
  @MaxLength(1000)
  reason!: string;
}
