import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { KycSubmission, KycSchema } from './kyc.schema';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { UsersModule } from '../users/users.module';
import { memoryStorage } from 'multer';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: KycSubmission.name, schema: KycSchema }]),
    MulterModule.register({ storage: memoryStorage() }), // keep files in memory for Cloudinary upload
    CloudinaryModule,
    UsersModule,
  ],
  providers: [KycService],
  controllers: [KycController],
})
export class KycModule {}