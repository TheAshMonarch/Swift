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

@Schema({ _id: false })
export class StoredFile {
  @Prop({ type: String, required: true })
  publicId!: string;

  @Prop({ type: String, required: true })
  resourceType!: string;

  @Prop({ type: String, required: true })
  format!: string;
}
const StoredFileSchema = SchemaFactory.createForClass(StoredFile);

@Schema({ timestamps: true })
export class KycSubmission extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: KycStatus, default: KycStatus.PENDING })
  status: KycStatus = KycStatus.PENDING;

  @Prop({ type: String, enum: IdType, required: true })
  idType!: string;

  // Private Cloudinary files (type 'authenticated'). Clients never see these;
  // KycService.toResponse() turns them into short-lived signed URLs.
  @Prop({ type: StoredFileSchema })
  idImageFile?: StoredFile; // government ID

  @Prop({ type: StoredFileSchema })
  selfieFile?: StoredFile;

  @Prop({ type: [StoredFileSchema], default: [] })
  portfolioFiles: StoredFile[] = []; // certificates, work samples

  // LEGACY: public URLs from submissions made before files became private
  @Prop({ type: String })
  idImageUrl?: string;

  @Prop({ type: String })
  selfieUrl?: string;

  @Prop({ type: [String], default: undefined })
  portfolioUrls?: string[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId; // admin who approved/rejected

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: String })
  rejectionReason?: string;
}

export const KycSchema = SchemaFactory.createForClass(KycSubmission);