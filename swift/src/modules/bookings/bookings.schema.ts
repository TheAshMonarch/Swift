import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BookingStatus {
  PENDING = 'pending',       // seeker created booking
  ACCEPTED = 'accepted',     // professional accepted
  FUNDED = 'funded',         // seeker paid into escrow
  IN_PROGRESS = 'in_progress', // work started
  COMPLETED = 'completed',   // professional marked done
  RELEASED = 'released',     // funds released to professional
  DISPUTED = 'disputed',     // seeker raised dispute
  REFUNDED = 'refunded',     // funds returned to seeker
  CANCELLED = 'cancelled',   // cancelled before funding
}

@Schema({ timestamps: true })
export class Booking extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  seekerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  professionalId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  serviceDescription!: string;

  @Prop({ type: Number, required: true, min: 0 })
  agreedAmount!: number; // in kobo (Paystack uses kobo)

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING })
  status: BookingStatus = BookingStatus.PENDING;

  // Paystack references
  @Prop({ type: String })
  paystackReference?: string;   // used to verify payment

  @Prop({ type: String })
  paystackTransferCode?: string; // used to release payout

  // Swift's commission (e.g. 10%)
  @Prop({ type: Number, default: 0 })
  commissionAmount: number = 0;

  @Prop({ type: Number, default: 0 })
  professionalPayout: number = 0;

  @Prop({ type: String })
  disputeReason?: string;

  @Prop({ type: Date })
  fundedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  releasedAt?: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);