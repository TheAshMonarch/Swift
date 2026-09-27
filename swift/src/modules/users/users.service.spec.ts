import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService, MAX_WORK_PHOTOS } from './users.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });
const selectExec = (value: unknown) => ({
  select: jest.fn().mockReturnValue(exec(value)),
});

describe('UsersService work photos', () => {
  let service: UsersService;
  let userModel: Record<string, jest.Mock>;
  let cloudinary: { upload: jest.Mock; destroy: jest.Mock };
  const userId = new Types.ObjectId().toString();
  const photo = (n: number) => ({
    _id: new Types.ObjectId(),
    url: `https://res.cloudinary.com/x/work/${n}.jpg`,
    publicId: `swift/work/${userId}/${n}`,
  });

  beforeEach(async () => {
    userModel = { findById: jest.fn(), findOneAndUpdate: jest.fn() };
    let n = 0;
    cloudinary = {
      upload: jest.fn().mockImplementation(() => {
        n += 1;
        return Promise.resolve({
          secure_url: `https://res.cloudinary.com/x/new/${n}.jpg`,
          public_id: `swift/work/${userId}/new${n}`,
        });
      }),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken('User'), useValue: userModel },
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('addWorkPhotos', () => {
    it('only professionals can add work photos', async () => {
      userModel.findById.mockReturnValue(
        selectExec({ role: 'seeker', workPhotos: [] }),
      );
      await expect(
        service.addWorkPhotos(userId, [Buffer.from('x')]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it('rejects before uploading when the limit would be exceeded', async () => {
      userModel.findById.mockReturnValue(
        selectExec({
          role: 'professional',
          workPhotos: Array.from({ length: MAX_WORK_PHOTOS - 1 }, (_, i) => photo(i)),
        }),
      );
      await expect(
        service.addWorkPhotos(userId, [Buffer.from('a'), Buffer.from('b')]),
      ).rejects.toThrow(`up to ${MAX_WORK_PHOTOS} work photos`);
      expect(cloudinary.upload).not.toHaveBeenCalled();
    });

    it('uploads publicly and appends in one conditional update', async () => {
      userModel.findById.mockReturnValue(
        selectExec({ role: 'professional', workPhotos: [photo(1)] }),
      );
      userModel.findOneAndUpdate.mockReturnValue(selectExec({ _id: userId }));

      await service.addWorkPhotos(userId, [Buffer.from('a'), Buffer.from('b')]);

      expect(cloudinary.upload).toHaveBeenCalledTimes(2);
      expect(cloudinary.upload.mock.calls[0][1]).toMatchObject({
        folder: `swift/work/${userId}`,
        resource_type: 'image',
      });
      expect(cloudinary.upload.mock.calls[0][1].type).toBeUndefined(); // public, unlike KYC
      const [filter, update] = userModel.findOneAndUpdate.mock.calls[0];
      // the size guard makes concurrent uploads unable to exceed the limit
      expect(JSON.stringify(filter)).toContain(String(MAX_WORK_PHOTOS - 2));
      expect(update.$push.workPhotos.$each).toHaveLength(2);
    });

    it('deletes the new uploads if a concurrent upload filled the slots', async () => {
      userModel.findById.mockReturnValue(
        selectExec({ role: 'professional', workPhotos: [] }),
      );
      userModel.findOneAndUpdate.mockReturnValue(selectExec(null));

      await expect(
        service.addWorkPhotos(userId, [Buffer.from('a')]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.destroy).toHaveBeenCalledWith(`swift/work/${userId}/new1`);
    });

    it('cleans up the successful uploads when one upload fails', async () => {
      userModel.findById.mockReturnValue(
        selectExec({ role: 'professional', workPhotos: [] }),
      );
      cloudinary.upload
        .mockResolvedValueOnce({ secure_url: 'u1', public_id: 'p1' })
        .mockRejectedValueOnce(new Error('cloudinary down'));

      await expect(
        service.addWorkPhotos(userId, [Buffer.from('a'), Buffer.from('b')]),
      ).rejects.toThrow('cloudinary down');
      expect(cloudinary.destroy).toHaveBeenCalledWith('p1');
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('removeWorkPhoto', () => {
    it('pulls the photo and deletes it from Cloudinary', async () => {
      const target = photo(3);
      userModel.findOneAndUpdate.mockReturnValue(
        selectExec({ workPhotos: [photo(1), target] }),
      );
      userModel.findById.mockReturnValue(selectExec({ _id: userId, workPhotos: [] }));

      await service.removeWorkPhoto(userId, target._id.toString());

      const [filter, update] = userModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({ _id: userId });
      expect(update).toEqual({ $pull: { workPhotos: { _id: target._id.toString() } } });
      expect(cloudinary.destroy).toHaveBeenCalledWith(target.publicId);
    });

    it('404s when the photo is not the caller’s', async () => {
      userModel.findOneAndUpdate.mockReturnValue(selectExec(null));
      await expect(
        service.removeWorkPhoto(userId, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cloudinary.destroy).not.toHaveBeenCalled();
    });
  });
});
