import { Schema } from 'mongoose';
import { MessageSchema } from '../modules/chat/chat.schema';
import { BookingSchema } from '../modules/bookings/bookings.schema';
import { KycSchema } from '../modules/kyc/kyc.schema';

// Reference fields must be real ObjectId paths. Declaring them with the
// Types.ObjectId *class* makes Mongoose treat them as Mixed, which silently
// disables casting: queries with string ids then match nothing (this broke
// chat history, mark-as-read and unread counts).
const REFERENCE_PATHS: [string, Schema, string[]][] = [
  ['Message', MessageSchema, ['senderId', 'receiverId', 'bookingId']],
  ['Booking', BookingSchema, ['seekerId', 'professionalId', 'resolvedBy']],
  ['KycSubmission', KycSchema, ['userId', 'reviewedBy']],
];

describe('schema reference fields', () => {
  for (const [model, schema, paths] of REFERENCE_PATHS) {
    it.each(paths)(`${model}.%s is an ObjectId path`, (path) => {
      expect(schema.path(path)?.instance).toBe('ObjectId');
    });
  }
});
