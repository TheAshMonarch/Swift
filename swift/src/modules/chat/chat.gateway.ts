import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

interface SendMessagePayload {
  receiverId?: unknown;
  content?: unknown;
  bookingId?: unknown;
}

interface MarkReadPayload {
  senderId?: unknown;
}

@WebSocketGateway({
  cors: {
    // Same origin policy as the HTTP API — no wildcard in production.
    origin: process.env.FRONTEND_URL ?? false,
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Track userId → set of socketIds (a user may have several tabs/devices open)
  private connectedUsers = new Map<string, Set<string>>();

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !token) {
        throw new Error('missing token');
      }
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new Error('invalid token payload: missing or invalid sub claim');
      }
      client.data.userId = payload.sub;
      const sockets = this.connectedUsers.get(payload.sub) ?? new Set<string>();
      sockets.add(client.id);
      this.connectedUsers.set(payload.sub, sockets);
    } catch {
      client.disconnect(); // invalid token → kick them out
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      // Only remove THIS socket; other tabs/devices of the same user stay online.
      const sockets = this.connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.connectedUsers.delete(userId);
        }
      }
    }
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    const senderId = client.data.userId;
    if (!senderId) return;

    // Validate payload: sender identity comes from the authenticated socket,
    // never from the client body.
    const { receiverId, content, bookingId } = payload ?? {};
    if (
      typeof receiverId !== 'string' ||
      !Types.ObjectId.isValid(receiverId) ||
      receiverId === senderId ||
      typeof content !== 'string' ||
      content.trim().length === 0 ||
      content.length > 2000
    ) {
      client.emit('message_error', { error: 'Invalid message payload' });
      return;
    }
    if (bookingId !== undefined && !Types.ObjectId.isValid(String(bookingId))) {
      client.emit('message_error', { error: 'Invalid bookingId' });
      return;
    }

    // Save to DB
    const message = await this.chatService.saveMessage({
      senderId,
      receiverId,
      content: content.trim(),
      bookingId: bookingId ? String(bookingId) : undefined,
    });

    // Deliver to every socket of the receiver (all their tabs/devices)
    const receiverSockets = this.connectedUsers.get(receiverId);
    if (receiverSockets) {
      for (const socketId of receiverSockets) {
        this.server.to(socketId).emit('new_message', message);
      }
    }

    // Confirm delivery to sender
    client.emit('message_sent', message);
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { receiverId?: unknown },
  ) {
    const senderId = client.data.userId;
    if (!senderId || typeof payload?.receiverId !== 'string') return;

    const receiverSockets = this.connectedUsers.get(payload.receiverId);
    if (receiverSockets) {
      for (const socketId of receiverSockets) {
        this.server.to(socketId).emit('user_typing', { senderId });
      }
    }
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MarkReadPayload,
  ) {
    const receiverId = client.data.userId;
    if (!receiverId) return;

    // SECURITY: the reader is the authenticated socket user; the client may
    // only tell us WHICH conversation partner's messages were read.
    const { senderId } = payload ?? {};
    if (typeof senderId !== 'string' || !Types.ObjectId.isValid(senderId)) {
      return;
    }

    await this.chatService.markAsRead(senderId, receiverId);
  }
}
