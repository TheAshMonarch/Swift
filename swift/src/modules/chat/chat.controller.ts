import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Get all conversations for current user
  @Get('conversations')
  getConversations(@Req() req: any) {
    return this.chatService.getMyConversations(req.user.userId);
  }

  // Get message history with a specific user
  @Get(':userId')
  getConversation(@Req() req: any, @Param('userId') otherId: string) {
    return this.chatService.getConversation(req.user.userId, otherId);
  }

  // Unread message count (for notification badge)
  @Get('unread/count')
  getUnreadCount(@Req() req: any) {
    return this.chatService.getUnreadCount(req.user.userId);
  }
}