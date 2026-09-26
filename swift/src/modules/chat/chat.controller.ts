import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { Types } from 'mongoose';

export class GetMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  before?: number; // timestamp (ms) cursor for pagination
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Unread message count (for notification badge)
  // NOTE: declared before the :userId route so it isn't shadowed by it
  @Get('unread/count')
  getUnreadCount(@Req() req: any) {
    return this.chatService.getUnreadCount(req.user.userId);
  }

  // Get all conversations for current user
  @Get('conversations')
  getConversations(@Req() req: any) {
    return this.chatService.getMyConversations(req.user.userId);
  }

  // Get message history with a specific user (paginated, newest page first)
  @Get(':userId')
  getConversation(
    @Req() req: any,
    @Param('userId') otherId: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    if (!Types.ObjectId.isValid(otherId)) return [];
    return this.chatService.getConversation(req.user.userId, otherId, {
      limit: query.limit ?? 50,
      before: query.before,
    });
  }
}
