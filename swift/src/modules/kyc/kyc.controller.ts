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
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RejectKycDto } from './dto/review-kyc.dto';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // Professional submits KYC documents
  @Post('submit')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'idImage', maxCount: 1 },   // government ID
      { name: 'selfie', maxCount: 1 },    // selfie
      { name: 'portfolio', maxCount: 5 }, // optional certificates
    ]),
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
  getPending(@Req() req: any) {
    if (req.user.role !== 'admin') throw new BadRequestException('Admins only');
    return this.kycService.getPending();
  }

  // Admin: view all submissions
  @Get('all')
  getAll(@Req() req: any) {
    if (req.user.role !== 'admin') throw new BadRequestException('Admins only');
    return this.kycService.getAll();
  }

  // Admin: approve a submission
  @Put(':id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    if (req.user.role !== 'admin') throw new BadRequestException('Admins only');
    return this.kycService.approve(id, req.user.userId);
  }

  // Admin: reject a submission
  @Put(':id/reject')
  reject(@Req() req: any, @Param('id') id: string, @Body() dto: RejectKycDto) {
    if (req.user.role !== 'admin') throw new BadRequestException('Admins only');
    return this.kycService.reject(id, req.user.userId, dto.reason);
  }
}