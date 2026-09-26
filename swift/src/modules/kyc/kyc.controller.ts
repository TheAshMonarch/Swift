import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RejectKycDto } from './dto/review-kyc.dto';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // Professional submits KYC documents
  @Post('submit')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idImage', maxCount: 1 }, // government ID
        { name: 'selfie', maxCount: 1 }, // selfie
        { name: 'portfolio', maxCount: 5 }, // optional certificates
      ],
      {
        storage: memoryStorage(),
        limits: {
          fileSize: MAX_FILE_BYTES, // stop memory-DoS via huge uploads
          files: 7,
        },
        fileFilter: (_req, file, cb) => {
          if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(new BadRequestException('Only JPEG, PNG, WebP, or PDF files are allowed'), false);
          }
          cb(null, true);
        },
      },
    ),
  )
  async submit(
    @Req() req: any,
    @UploadedFiles()
    files: {
      idImage?: Express.Multer.File[];
      selfie?: Express.Multer.File[];
      portfolio?: Express.Multer.File[];
    },
    @Body('idType') idType: string,
  ) {
    if (!files.idImage?.[0]) throw new BadRequestException('ID image is required');
    if (!files.selfie?.[0]) throw new BadRequestException('Selfie is required');
    if (!idType) throw new BadRequestException('idType is required');

    return this.kycService.submitKyc(req.user.userId, idType, {
      idImage: files.idImage[0],
      selfie: files.selfie[0],
      portfolio: files.portfolio,
    });
  }

  // Professional checks their own KYC status
  @Get('status')
  getStatus(@Req() req: any) {
    return this.kycService.getMyStatus(req.user.userId);
  }

  // Admin: view pending submissions
  @Get('pending')
  @Roles('admin')
  getPending(@Req() req: any) {
    return this.kycService.getPending();
  }

  // Admin: view all submissions
  @Get('all')
  @Roles('admin')
  getAll(@Req() req: any) {
    return this.kycService.getAll();
  }

  // Admin: approve a submission
  @Put(':id/approve')
  @Roles('admin')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.kycService.approve(id, req.user.userId);
  }

  // Admin: reject a submission
  @Put(':id/reject')
  @Roles('admin')
  reject(@Req() req: any, @Param('id') id: string, @Body() dto: RejectKycDto) {
    return this.kycService.reject(id, req.user.userId, dto.reason);
  }
}
