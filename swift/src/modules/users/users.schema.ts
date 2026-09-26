import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// --- GEOSPATIAL LOCATION STRUCTURE ---
@Schema({ _id: false })
export class Location {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: string = 'Point';

  @Prop({ type: [Number], required: true }) // [longitude, latitude]
  coordinates!: [number, number]; 
}

// --- PROFESSIONAL METRICS SUB-DOCUMENT ---
@Schema({ _id: false })
export class ProfessionalProfile {
  @Prop({ type: String, required: true })
  category!: string;

  @Prop({ type: [String], default: [] })
  skills: string[] = [];

  @Prop({ type: Number, required: true, min: 0 })
  hourlyRate!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  averageRating: number = 0;

  @Prop({ type: Boolean, default: false })
  isBadgeVerified: boolean = false;

  @Prop({ type: Number, default: 0 })
  reviewCount: number = 0;

  @Prop({ type: Number, default: 0 })
  completedJobs: number = 0;

  @Prop({ type: Number, default: 0 })
  totalEarnings: number = 0;
}

// --- CENTRAL USER SCHEMA ---
@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  email!: string;

  @Prop({ type: String, required: true, unique: true })
  phone!: string;

  @Prop({ type: String, required: true })
  passwordHash!: string;

  @Prop({ type: String, enum: ['seeker', 'professional', 'admin'], required: true })
  role!: string;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean = false;

  @Prop({ type: Location, required: true })
  location!: Location;

  @Prop({ type: ProfessionalProfile, required: false })
  proProfile?: ProfessionalProfile;

  @Prop({ type: String, sparse: true })
  googleId?: string;

  // New: Added support for incoming Google OAuth profile pictures or uploaded files
  @Prop({ type: String, required: false })
  avatar?: string;

  @Prop({ type: Date })
  lastLogin?: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean = true;

  @Prop({
    type: { accountNumber: String, bankCode: String, bankName: String, recipientCode: String },
    required: false,
  })
  bankDetails?: {
    accountNumber: string;
    bankCode: string;
    bankName: string;
    recipientCode?: string; // cached Paystack transfer recipient
  };
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ location: '2dsphere' });