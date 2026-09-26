import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { KycSubmission, KycStatus, IdType } from './kyc.schema';
import { UsersService } from '../users/users.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

// What clients receive: same shape as before, with short-lived signed URLs.
export type KycResponse = Omit<
  KycSubmission,
  'idImageFile' | 'selfieFile' | 'portfolioFiles'
> & { idImageUrl?: string; selfieUrl?: string; portfolioUrls: string[] };

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycSubmission.name) private kycModel: Model<KycSubmission>,
    private usersService: UsersService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // Identity documents are stored privately — never as public URLs.
  private uploadPrivate(file: Express.Multer.File, folder: string) {
    return this.cloudinaryService.uploadPrivate(file.buffer, `swift/kyc/${folder}`);
  }

  // Replace stored private-file refs with signed URLs (valid 15 minutes).
  toResponse(submission: KycSubmission): KycResponse {
    const obj = submission.toObject();
    const { idImageFile, selfieFile, portfolioFiles, ...rest } = obj;
    const sign = this.cloudinaryService.signedUrl.bind(this.cloudinaryService);
    return {
      ...rest,
      idImageUrl: idImageFile ? sign(idImageFile) : obj.idImageUrl,
      selfieUrl: selfieFile ? sign(selfieFile) : obj.selfieUrl,
      portfolioUrls: portfolioFiles?.length
        ? portfolioFiles.map(sign)
        : (obj.portfolioUrls ?? []),
    };
  }

  async submitKyc(
    userId: string,
    rawIdType: string,
    files: {
      idImage: Express.Multer.File;
      selfie: Express.Multer.File;
      portfolio?: Express.Multer.File[];
    },
  ): Promise<KycResponse> {
    // Only professionals can submit KYC
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'professional') {
      throw new ForbiddenException('Only professionals can submit KYC');
    }

    // Whitelist the ID type before persisting or uploading anything.
    if (!Object.values(IdType).includes(rawIdType as IdType)) {
      throw new BadRequestException('Invalid ID type');
    }
    const idType = rawIdType as IdType;

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

    // Upload files privately to Cloudinary
    const [idImageFile, selfieFile, portfolioFiles] = await Promise.all([
      this.uploadPrivate(files.idImage, 'id-documents'),
      this.uploadPrivate(files.selfie, 'selfies'),
      Promise.all((files.portfolio ?? []).map((f) => this.uploadPrivate(f, 'portfolio'))),
    ]);

    // Upsert — allow resubmission after rejection
    if (existing) {
      existing.idType = idType;
      existing.idImageFile = idImageFile;
      existing.selfieFile = selfieFile;
      existing.portfolioFiles = portfolioFiles;
      existing.idImageUrl = undefined;
      existing.selfieUrl = undefined;
      existing.portfolioUrls = undefined;
      existing.status = KycStatus.PENDING;
      existing.rejectionReason = undefined;
      existing.reviewedAt = undefined;
      return this.toResponse(await existing.save());
    }

    const created = await this.kycModel.create({
      userId: new Types.ObjectId(userId),
      idType,
      idImageFile,
      selfieFile,
      portfolioFiles,
    });
    return this.toResponse(created);
  }

  async getMyStatus(userId: string): Promise<KycResponse | null> {
    const submission = await this.kycModel.findOne({ userId: new Types.ObjectId(userId) });
    return submission ? this.toResponse(submission) : null;
  }

  // Admin: get all pending submissions
  async getPending(): Promise<KycResponse[]> {
    const submissions = await this.kycModel
      .find({ status: KycStatus.PENDING })
      .populate('userId', '-passwordHash -bankDetails')
      .sort({ createdAt: 1 }) // oldest first
      .exec();
    return submissions.map((s) => this.toResponse(s));
  }

  // Admin: get all submissions
  async getAll(): Promise<KycResponse[]> {
    const submissions = await this.kycModel
      .find()
      .populate('userId', '-passwordHash -bankDetails')
      .sort({ createdAt: -1 })
      .exec();
    return submissions.map((s) => this.toResponse(s));
  }

  // Admin: approve
  async approve(submissionId: string, adminId: string): Promise<KycResponse> {
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

    return this.toResponse(submission);
  }

  // Admin: reject
  async reject(
    submissionId: string,
    adminId: string,
    reason: string,
  ): Promise<KycResponse> {
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

    return this.toResponse(submission);
  }
}