import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  senderId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  receiverId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', required: false })
  bookingId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  content!: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean = false;
}

export const MessageSchema = SchemaFactory.createForClass(Message);