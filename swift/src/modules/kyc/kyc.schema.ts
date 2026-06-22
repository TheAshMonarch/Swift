import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum KycStatus {
  NONE = 'none',
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export enum IdType {
  NIN = 'nin',
  VOTERS_CARD = 'voters_card',
  PASSPORT = 'passport',
  DRIVERS_LICENSE = 'drivers_license',
}

@Schema({ timestamps: true })
export class KycSubmission extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: KycStatus, default: KycStatus.PENDING })
  status: KycStatus = KycStatus.PENDING;

  @Prop({ type: String, enum: IdType, required: true })
  idType!: string;

  @Prop({ type: String, required: true })
  idImageUrl!: string; // Cloudinary URL of government ID

  @Prop({ type: String, required: true })
  selfieUrl!: string; // Cloudinary URL of selfie

  @Prop({ type: [String], default: [] })
  portfolioUrls: string[] = []; // certificates, work samples

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId; // admin who approved/rejected

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: String })
  rejectionReason?: string;
}

export const KycSchema = SchemaFactory.createForClass(KycSubmission);