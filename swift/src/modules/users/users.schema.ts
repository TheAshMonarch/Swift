import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// --- GEOSPATIAL LOCATION STRUCTURE ---
@Schema({ _id: false })
export class Location {
  // It has a default value, so let's use '=' instead of '?'
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: string = 'Point';

  @Prop({ type: [Number], required: true }) // [longitude, latitude]
  coordinates!: number[];
}

// --- PROFESSIONAL METRICS SUB-DOCUMENT ---
@Schema({ _id: false })
export class ProfessionalProfile {
  // Required in Mongoose -> Use '!'
  @Prop({ type: String, required: true })
  category!: string; // e.g., 'Plumbing', 'Electrical', 'Tutor'

  // Has a default array -> Use '='
  @Prop({ type: [String], default: [] })
  skills: string[] = [];

  // Required in Mongoose -> Use '!'
  @Prop({ type: Number, required: true, min: 0 })
  hourlyRate!: number;

  // Has a default number -> Use '='
  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  averageRating: number = 0;

  // Has a default boolean -> Use '='
  @Prop({ type: Boolean, default: false })
  isBadgeVerified: boolean = false;
}

// --- CENTRAL USER SCHEMA ---
@Schema({ timestamps: true })
export class User extends Document {
  // Required in Mongoose -> Use '!'
  @Prop({ type: String, required: true })
  name!: string;

  // Required in Mongoose -> Use '!'
  @Prop({ type: String, required: true, unique: true, index: true })
  email!: string;

  // Required in Mongoose -> Use '!'
  @Prop({ type: String, required: true, unique: true })
  phone!: string;

  // Required in Mongoose -> Use '!'
  @Prop({ type: String, required: true })
  passwordHash!: string;

  // Required in Mongoose -> Use '!'
  @Prop({ type: String, enum: ['seeker', 'professional', 'admin'], required: true })
  role!: string;

  // Has a default boolean -> Use '='
  @Prop({ type: Boolean, default: false })
  isVerified: boolean = false;

  // Required in Mongoose -> Use '!'
  @Prop({ type: Location, required: true })
  location!: Location;

  // Truly optional (only for professionals) -> Keep '?'
  @Prop({ type: ProfessionalProfile, required: false })
  proProfile?: ProfessionalProfile;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Ensure fast local matching calculations via a 2dsphere index
UserSchema.index({ location: '2dsphere' });
