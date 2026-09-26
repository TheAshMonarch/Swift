import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { KycService } from './kyc.service';
import { KycSubmission } from './kyc.schema';
import { UsersService } from '../users/users.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

describe('KycService', () => {
  let service: KycService;
  const cloudinaryService = {
    uploadPrivate: jest.fn(),
    signedUrl: jest.fn(
      (f: { publicId: string }) => `https://signed/${f.publicId}`,
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: getModelToken('KycSubmission'), useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: CloudinaryService, useValue: cloudinaryService },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
  });

  const asDoc = (obj: Record<string, unknown>) =>
    ({ toObject: () => obj }) as unknown as KycSubmission;

  it('replaces private file refs with signed URLs and hides the refs', () => {
    const file = (publicId: string) => ({
      publicId,
      resourceType: 'image',
      format: 'jpg',
    });
    const res = service.toResponse(
      asDoc({
        status: 'pending',
        idImageFile: file('id'),
        selfieFile: file('selfie'),
        portfolioFiles: [file('p1')],
      }),
    );

    expect(res).toMatchObject({
      idImageUrl: 'https://signed/id',
      selfieUrl: 'https://signed/selfie',
      portfolioUrls: ['https://signed/p1'],
    });
    expect(res).not.toHaveProperty('idImageFile');
    expect(res).not.toHaveProperty('selfieFile');
    expect(res).not.toHaveProperty('portfolioFiles');
  });

  it('passes through legacy public URLs', () => {
    const res = service.toResponse(
      asDoc({
        idImageUrl: 'https://old/id',
        selfieUrl: 'https://old/s',
        portfolioUrls: [],
      }),
    );
    expect(res).toMatchObject({
      idImageUrl: 'https://old/id',
      selfieUrl: 'https://old/s',
    });
  });
});
