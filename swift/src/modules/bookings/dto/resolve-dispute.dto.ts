import { IsIn } from 'class-validator';
import type { DisputeOutcome } from '../bookings.service';

export class ResolveDisputeDto {
  @IsIn(['refund', 'release'])
  outcome!: DisputeOutcome;
}
