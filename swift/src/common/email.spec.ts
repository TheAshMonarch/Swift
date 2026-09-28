import { emailMatch, normalizeEmail } from './email';

describe('email helpers', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Chioma.Okafor@Gmail.COM ')).toBe('chioma.okafor@gmail.com');
    expect(normalizeEmail(42)).toBe(42); // non-strings pass through to validation
  });

  it('matches stored emails regardless of case, exactly', () => {
    const { $regex, $options } = emailMatch('chioma@x.com');
    const re = new RegExp($regex, $options);
    expect(re.test('Chioma@X.com')).toBe(true);
    expect(re.test('chioma@x.com.evil.io')).toBe(false);
    expect(re.test('xchioma@x.com')).toBe(false);
  });

  it('escapes regex characters in the address', () => {
    const re = new RegExp(emailMatch('a+b@x.com').$regex, 'i');
    expect(re.test('a+b@x.com')).toBe(true);
    expect(re.test('aab@x.com')).toBe(false);
  });
});
