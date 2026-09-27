import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from './users.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

// Fields other users must never see. Use for every response that exposes a user
// who is not the caller (profiles, search, populated bookings, chat partners).
export const PUBLIC_USER_PROJECTION = '-passwordHash -phone -bankDetails -workPhotos.publicId';

export const MAX_WORK_PHOTOS = 8;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userModel.findOne({
      $or: [{ email: dto.email }, { phone: dto.phone }],
    });
    if (existing) throw new BadRequestException('Email or phone already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = new this.userModel({
      ...dto,
      passwordHash,
      location: { type: 'Point', coordinates: dto.location.coordinates },
      proProfile: dto.proProfile ?? undefined,
    });
    return user.save();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).select('-passwordHash').exec();
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<User | null> {
    return this.userModel.findById(id).select('-passwordHash').exec();
  }

  // Public-safe projection: never expose phone, bank details, or hashes to other users.
  async findPublicById(id: string | Types.ObjectId): Promise<User | null> {
    return this.userModel
      .findById(id)
      .select(PUBLIC_USER_PROJECTION)
      .exec();
  }

  // FIXED: Flattens objects into MongoDB dot notation format to prevent overwriting nested fields
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const updateQuery: any = {};

    if (dto.name) updateQuery.name = dto.name;
    if (dto.phone) updateQuery.phone = dto.phone;

    if (dto.location?.coordinates) {
      // Validate coordinates are [longitude, latitude] tuple of numbers
      if (!Array.isArray(dto.location.coordinates) || dto.location.coordinates.length !== 2 ||
          !dto.location.coordinates.every(c => typeof c === 'number')) {
        throw new BadRequestException('Invalid coordinates: must be [longitude, latitude]');
      }
      updateQuery['location.coordinates'] = dto.location.coordinates;
    }

    if (dto.proProfile) {
      if (dto.proProfile.category) updateQuery['proProfile.category'] = dto.proProfile.category;
      if (dto.proProfile.skills) updateQuery['proProfile.skills'] = dto.proProfile.skills;
      if (dto.proProfile.hourlyRate !== undefined) updateQuery['proProfile.hourlyRate'] = dto.proProfile.hourlyRate;
    }

    // FIXED: bankDetails were previously accepted by the DTO but silently
    // dropped here — which made escrow payouts impossible. Persist them.
    if (dto.bankDetails) {
      updateQuery['bankDetails.accountNumber'] = dto.bankDetails.accountNumber;
      updateQuery['bankDetails.bankCode'] = dto.bankDetails.bankCode;
      updateQuery['bankDetails.bankName'] = dto.bankDetails.bankName;
      // Changing bank account invalidates any cached Paystack recipient.
      if (!updateQuery.$unset) updateQuery.$unset = {};
      updateQuery.$unset['bankDetails.recipientCode'] = 1;
    }

    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: updateQuery }, { new: true })
      .select('-passwordHash')
      .exec();

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Upload a new profile picture (public; one per user, overwritten on change)
  async updateAvatar(id: string, image: Buffer): Promise<User> {
    const result = await this.cloudinaryService.upload(image, {
      folder: 'swift/avatars',
      public_id: id,
      overwrite: true,
      invalidate: true,
      resource_type: 'image',
      transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
    });
    // secure_url contains the version, so clients' caches refresh on change
    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: { avatar: result.secure_url } }, { new: true })
      .select('-passwordHash')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Upload public portfolio photos. Checked up front for a clear error, then
  // enforced atomically: the $push only applies while there is still room, so
  // parallel uploads can't exceed the limit. Uploaded files are deleted again
  // whenever the photos don't end up saved.
  async addWorkPhotos(id: string, images: Buffer[]): Promise<User> {
    if (!images.length) throw new BadRequestException('Add at least one photo');

    const user = await this.userModel.findById(id).select('role workPhotos').exec();
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'professional') {
      throw new ForbiddenException('Only professionals can add work photos');
    }
    const current = user.workPhotos?.length ?? 0;
    const limitMessage = `You can have up to ${MAX_WORK_PHOTOS} work photos. You have ${current}.`;
    if (current + images.length > MAX_WORK_PHOTOS) throw new BadRequestException(limitMessage);

    const results = await Promise.allSettled(
      images.map((image) =>
        this.cloudinaryService.upload(image, {
          folder: `swift/work/${id}`,
          resource_type: 'image',
          transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto' }],
        }),
      ),
    );
    const uploaded = results.flatMap((r) =>
      r.status === 'fulfilled' ? [{ url: r.value.secure_url, publicId: r.value.public_id }] : [],
    );
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) {
      await this.destroyQuietly(uploaded.map((p) => p.publicId));
      throw failure.reason;
    }

    const updated = await this.userModel
      .findOneAndUpdate(
        {
          _id: id,
          $expr: {
            $lte: [{ $size: { $ifNull: ['$workPhotos', []] } }, MAX_WORK_PHOTOS - uploaded.length],
          },
        },
        { $push: { workPhotos: { $each: uploaded } } },
        { new: true },
      )
      .select('-passwordHash')
      .exec();
    if (!updated) {
      await this.destroyQuietly(uploaded.map((p) => p.publicId));
      throw new BadRequestException(limitMessage);
    }
    return updated;
  }

  async removeWorkPhoto(id: string, photoId: string): Promise<User> {
    const before = await this.userModel
      .findOneAndUpdate(
        { _id: id, 'workPhotos._id': photoId },
        { $pull: { workPhotos: { _id: photoId } } },
      )
      .select('workPhotos')
      .exec();
    if (!before) throw new NotFoundException('Photo not found');

    const removed = before.workPhotos?.find((p) => p._id.toString() === photoId);
    if (removed) await this.destroyQuietly([removed.publicId]);

    const user = await this.userModel.findById(id).select('-passwordHash').exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Best effort: an orphaned file costs storage, not correctness.
  private async destroyQuietly(publicIds: string[]): Promise<void> {
    const results = await Promise.allSettled(publicIds.map((pid) => this.cloudinaryService.destroy(pid)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.logger.warn(`Could not delete Cloudinary file ${publicIds[i]}`);
    });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, { $set: { lastLogin: new Date() } }).exec();
  }

  async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    name: string;
    avatar?: string;
  }): Promise<User> {
    let user = await this.userModel.findOne({
      $or: [{ googleId: profile.googleId }, { email: profile.email }],
    });
    if (user) {
      if (!user.googleId) {
        user.googleId = profile.googleId;
        await user.save();
      }
      return user;
    }
    return this.userModel.create({
      ...profile,
      phone: `google-${Date.now()}`,
      passwordHash: 'OAUTH_NO_PASSWORD',
      role: 'seeker',
      isVerified: true,
      location: { type: 'Point', coordinates: [0, 0] },
    });
  }

  async searchProviders(dto: SearchProvidersDto): Promise<User[]> {
    const pipeline: any[] = [];

    if (dto.coordinates) {
      pipeline.push({
        $geoNear: {
          near: { type: 'Point', coordinates: dto.coordinates },
          distanceField: 'distance',
          maxDistance: (dto.radiusKm ?? 50) * 1000,
          spherical: true,
          query: { role: 'professional', isVerified: true, isActive: true },
        },
      });
    } else {
      pipeline.push({ $match: { role: 'professional', isVerified: true, isActive: true } });
    }

    if (dto.category) {
      pipeline.push({ $match: { 'proProfile.category': dto.category } });
    }

    if (dto.skills?.length) {
      pipeline.push({ $match: { 'proProfile.skills': { $in: dto.skills } } });
    }

    if (dto.minRating) {
      pipeline.push({ $match: { 'proProfile.averageRating': { $gte: dto.minRating } } });
    }

    if (dto.minRate !== undefined || dto.maxRate !== undefined) {
      const rateFilter: any = {};
      if (dto.minRate !== undefined) rateFilter.$gte = dto.minRate;
      if (dto.maxRate !== undefined) rateFilter.$lte = dto.maxRate;
      pipeline.push({ $match: { 'proProfile.hourlyRate': rateFilter } });
    }

    pipeline.push({ $sort: { 'proProfile.averageRating': -1 } });
    pipeline.push({ $limit: dto.limit ?? 20 });
    pipeline.push({ $project: { passwordHash: 0, phone: 0, bankDetails: 0, 'workPhotos.publicId': 0 } });

    return this.userModel.aggregate(pipeline).exec();
  }

  // FIXED: Uses findOneAndUpdate with conditional criteria matching original read values 
  // to avoid concurrent overwrite race conditions
  async addRating(providerId: string, rating: number): Promise<User> {
    // Validate here as well as the DTO: this service method is reachable
    // from multiple call sites and the raw controller body bypasses nothing.
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    let updated: User | null = null;
    let attempts = 0;

    while (!updated && attempts < 3) {
      const user = await this.userModel.findById(providerId);
      if (!user || !user.proProfile) throw new NotFoundException('Provider not found');

      const oldCount = user.proProfile.reviewCount ?? 0;
      const oldAvg = user.proProfile.averageRating ?? 0;
      const newCount = oldCount + 1;
      const newAvg = parseFloat(((oldAvg * oldCount + rating) / newCount).toFixed(2));

      updated = await this.userModel
        .findOneAndUpdate(
          { 
            _id: providerId, 
            'proProfile.reviewCount': oldCount // Optimistic Locking check
          },
          { 
            $set: { 
              'proProfile.averageRating': newAvg, 
              'proProfile.reviewCount': newCount 
            } 
          },
          { new: true },
        )
        .select(PUBLIC_USER_PROJECTION)
        .exec();
        
      attempts++;
    }

    if (!updated) throw new BadRequestException('Transaction conflict: Please retry submitting rating.');
    return updated;
  }

  async incrementCompletedJobs(providerId: string, earnings = 0): Promise<User> {
    const updated = await this.userModel
      .findByIdAndUpdate(
        providerId,
        { $inc: { 'proProfile.completedJobs': 1, 'proProfile.totalEarnings': earnings } },
        { new: true },
      )
      .select('-passwordHash')
      .exec();
    if (!updated) throw new NotFoundException('Provider not found');
    return updated;
  }

  async getProviderStats(providerId: string): Promise<any> {
    const user = await this.findById(providerId);
    if (!user?.proProfile) throw new NotFoundException('Provider not found');
    return {
      averageRating: user.proProfile.averageRating,
      completedJobs: user.proProfile.completedJobs ?? 0,
      totalEarnings: user.proProfile.totalEarnings ?? 0,
      isBadgeVerified: user.proProfile.isBadgeVerified,
    };
  }

  async verifyProfessional(id: string): Promise<User> {
    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: { 'proProfile.isBadgeVerified': true, isVerified: true } }, { new: true })
      .select('-passwordHash')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Cache a Paystack transfer recipient code on the professional's record
  async setTransferRecipient(id: string, recipientCode: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        $set: { 'bankDetails.recipientCode': recipientCode },
      })
      .exec();
  }

  async deactivateUser(id: string): Promise<User> {
    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
      .select('-passwordHash')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}