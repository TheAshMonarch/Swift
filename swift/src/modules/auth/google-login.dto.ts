import { IsNotEmpty, IsString, IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LocationDto } from './register.dto';

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string; // The Id Token sent from the frontend app

  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto; // We still need coordinates to place them on the map
}
