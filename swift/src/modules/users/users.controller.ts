import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  @Put('me')
  updateMe(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.userId, dto);
  }

  // multipart/form-data with a single `avatar` file field
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
          return cb(new BadRequestException('Only JPEG, PNG, or WebP images are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadAvatar(@Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('avatar file is required');
    return this.usersService.updateAvatar(req.user.userId, file.buffer);
  }

  @Post('search/providers')
  searchProviders(@Body() dto: SearchProvidersDto) {
    return this.usersService.searchProviders(dto);
  }

  // Public-safe profile view: no phone, bank details, or password hash.
  @Get(':id')
  findById(@Param('id', IsObjectIdPipe) id: string) {
    return this.usersService.findPublicById(id).then((user) => {
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  // Ratings live on bookings: POST /bookings/:id/rating (one per completed booking).

  @Get(':id/stats')
  getStats(@Param('id', IsObjectIdPipe) id: string) {
    return this.usersService.getProviderStats(id);
  }
}