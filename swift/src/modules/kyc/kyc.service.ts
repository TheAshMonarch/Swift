import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { KycSubmission, KycStatus } from './kyc.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycSubmission.name) private kycModel: Model<KycSubmission>,
    private usersService: UsersService,
  ) {}

  // Upload a file buffer to Cloudinary and return the URL
  private async uploadToCloudinary(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: `swift/kyc/${folder}` }, (error, result) => {
          if (error || !result) return reject(error);
          resolve(result.secure_url);
        })
        .end(file.buffer);
    });
  }

  async submitKyc(
    userId: string,
    idType: string,
    files: {
      idImage: Express.Multer.File;
      selfie: Express.Multer.File;
      portfolio?: Express.Multer.File[];
    },
  ): Promise<KycSubmission> {
    // Only professionals can submit KYC
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'professional') {
      throw new ForbiddenException('Only professionals can submit KYC');
    }

    // Check if already submitted
    const existing = await this.kycModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (existing && existing.status === KycStatus.PENDING) {
      throw new BadRequestException('KYC already submitted and under review');
    }
    if (existing && existing.status === KycStatus.VERIFIED) {
      throw new BadRequestException('Already verified');
    }

    // Upload files to Cloudinary
    const [idImageUrl, selfieUrl] = await Promise.all([
      this.uploadToCloudinary(files.idImage, 'id-documents'),
      this.uploadToCloudinary(files.selfie, 'selfies'),
    ]);

    const portfolioUrls: string[] = [];
    if (files.portfolio?.length) {
      const uploads = await Promise.all(
        files.portfolio.map((f) => this.uploadToCloudinary(f, 'portfolio')),
      );
      portfolioUrls.push(...uploads);
    }

    // Upsert — allow resubmission after rejection
    if (existing) {
      existing.idType = idType;
      existing.idImageUrl = idImageUrl;
      existing.selfieUrl = selfieUrl;
      existing.portfolioUrls = portfolioUrls;
      existing.status = KycStatus.PENDING;
      existing.rejectionReason = undefined;
      existing.reviewedAt = undefined;
      return existing.save();
    }

    return this.kycModel.create({
      userId: new Types.ObjectId(userId),
      idType,
      idImageUrl,
      selfieUrl,
      portfolioUrls,
    });
  }

  async getMyStatus(userId: string): Promise<KycSubmission | null> {
    return this.kycModel.findOne({ userId: new Types.ObjectId(userId) });
  }

  // Admin: get all pending submissions
  async getPending(): Promise<KycSubmission[]> {
    return this.kycModel
      .find({ status: KycStatus.PENDING })
      .populate('userId', '-passwordHash')
      .sort({ createdAt: 1 }) // oldest first
      .exec();
  }

  // Admin: get all submissions
  async getAll(): Promise<KycSubmission[]> {
    return this.kycModel
      .find()
      .populate('userId', '-passwordHash')
      .sort({ createdAt: -1 })
      .exec();
  }

  // Admin: approve
  async approve(submissionId: string, adminId: string): Promise<KycSubmission> {
    const submission = await this.kycModel.findById(submissionId);
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== KycStatus.PENDING) {
      throw new BadRequestException('Submission is not pending');
    }

    submission.status = KycStatus.VERIFIED;
    submission.reviewedBy = new Types.ObjectId(adminId);
    submission.reviewedAt = new Date();
    await submission.save();

    // Set user as verified + badge
    await this.usersService.verifyProfessional(submission.userId.toString());

    return submission;
  }

  // Admin: reject
  async reject(
    submissionId: string,
    adminId: string,
    reason: string,
  ): Promise<KycSubmission> {
    const submission = await this.kycModel.findById(submissionId);
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== KycStatus.PENDING) {
      throw new BadRequestException('Submission is not pending');
    }

    submission.status = KycStatus.REJECTED;
    submission.reviewedBy = new Types.ObjectId(adminId);
    submission.reviewedAt = new Date();
    submission.rejectionReason = reason;
    await submission.save();

    return submission;
  }
}