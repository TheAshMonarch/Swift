// Emails are stored lowercased from now on, but older accounts may contain
// capitals, so lookups match case-insensitively.

export const normalizeEmail = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Exact, case-insensitive match for a Mongo filter: { email: emailMatch(e) }
export const emailMatch = (email: string): { $regex: string; $options: string } => ({
  $regex: `^${escapeRegex(email.trim())}$`,
  $options: 'i',
});
