import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Otp extends Document {
  @Prop({ type: String, required: true, index: true })
  phoneOrEmail!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  // 'verify' = email verification (plain code), 'reset' = password reset (SHA-256 of code)
  @Prop({ type: String, enum: ['verify', 'reset'], default: 'verify' })
  purpose: 'verify' | 'reset' = 'verify';

  // Failed guesses; reset codes are destroyed after MAX_RESET_ATTEMPTS
  @Prop({ type: Number, default: 0 })
  attempts: number = 0;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// Automatically delete OTP documents once expiresAt has passed
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });