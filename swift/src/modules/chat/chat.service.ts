import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message } from './chat.schema';

@Injectable()
export class ChatService {
  constructor(@InjectModel(Message.name) private messageModel: Model<Message>) {}

  async saveMessage(params: {
    senderId: string;
    receiverId: string;
    content: string;
    bookingId?: string;
  }): Promise<Message> {
    return this.messageModel.create({
      senderId: new Types.ObjectId(params.senderId),
      receiverId: new Types.ObjectId(params.receiverId),
      content: params.content,
      bookingId: params.bookingId ? new Types.ObjectId(params.bookingId) : undefined,
    });
  }

  async getConversation(
    userAId: string,
    userBId: string,
    options?: { limit?: number; before?: number },
  ): Promise<Message[]> {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

    const filter: Record<string, unknown> = {
      $or: [
        { senderId: userAId, receiverId: userBId },
        { senderId: userBId, receiverId: userAId },
      ],
    };
    // Cursor pagination: only messages strictly older than the cursor.
    if (options?.before !== undefined) {
      filter.createdAt = { $lt: new Date(options.before) };
    }

    // Newest page first, then reversed so the page reads chronologically.
    const docs = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('senderId', 'name avatar')
      .exec();
    return docs.reverse();
  }

  async getMyConversations(userId: string): Promise<any[]> {
    // Returns latest message per unique conversation partner
    return this.messageModel.aggregate([
      {
        $match: {
          $or: [
            { senderId: new Types.ObjectId(userId) },
            { receiverId: new Types.ObjectId(userId) },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$senderId', new Types.ObjectId(userId)] },
              '$receiverId',
              '$senderId',
            ],
          },
          lastMessage: { $first: '$$ROOT' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partner',
        },
      },
      { $unwind: '$partner' },
      { $project: { 'partner.passwordHash': 0 } },
    ]);
  }

  async markAsRead(senderId: string, receiverId: string): Promise<void> {
    await this.messageModel.updateMany(
      { senderId, receiverId, isRead: false },
      { $set: { isRead: true } },
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.messageModel.countDocuments({ receiverId: userId, isRead: false });
  }
}