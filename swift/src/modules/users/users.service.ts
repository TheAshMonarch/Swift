import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from './users.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchProvidersDto } from './dto/search-providers.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

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

  // FIXED: Flattens objects into MongoDB dot notation format to prevent overwriting nested fields
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const updateQuery: any = {};

    if (dto.name) updateQuery.name = dto.name;
    if (dto.phone) updateQuery.phone = dto.phone;

    if (dto.location?.coordinates) {
      updateQuery['location.coordinates'] = dto.location.coordinates;
    }

    if (dto.proProfile) {
      if (dto.proProfile.category) updateQuery['proProfile.category'] = dto.proProfile.category;
      if (dto.proProfile.skills) updateQuery['proProfile.skills'] = dto.proProfile.skills;
      if (dto.proProfile.hourlyRate !== undefined) updateQuery['proProfile.hourlyRate'] = dto.proProfile.hourlyRate;
    }

    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: updateQuery }, { new: true })
      .select('-passwordHash')
      .exec();

    if (!user) throw new NotFoundException('User not found');
    return user;
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
    pipeline.push({ $project: { passwordHash: 0 } });

    return this.userModel.aggregate(pipeline).exec();
  }

  // FIXED: Uses findOneAndUpdate with conditional criteria matching original read values 
  // to avoid concurrent overwrite race conditions
  async addRating(providerId: string, rating: number): Promise<User> {
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
        .select('-passwordHash')
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

  async deactivateUser(id: string): Promise<User> {
    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
      .select('-passwordHash')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}