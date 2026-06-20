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
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// Automatically delete expired OTP documents from MongoDB after 5 minutes
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });