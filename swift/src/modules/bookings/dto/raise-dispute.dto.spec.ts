import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RaiseDisputeDto } from './raise-dispute.dto';

const errors = (reason: unknown) =>
  validateSync(plainToInstance(RaiseDisputeDto, { reason })).map((e) => e.property);

describe('RaiseDisputeDto', () => {
  it('accepts a real reason and trims it', () => {
    const dto = plainToInstance(RaiseDisputeDto, { reason: '  The pipe still leaks  ' });
    expect(dto.reason).toBe('The pipe still leaks');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([[undefined], [''], ['    '], [42], ['x'.repeat(1001)]])('rejects %p', (reason) => {
    expect(errors(reason)).toContain('reason');
  });
});
