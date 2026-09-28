import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });
const sha = (code: string) => createHash('sha256').update(code).digest('hex');

describe('AuthService password reset', () => {
  let service: AuthService;
  let userModel: Record<string, jest.Mock>;
  let otpModel: Record<string, jest.Mock>;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    otpModel = {
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('User'), useValue: userModel },
        { provide: getModelToken('Otp'), useValue: otpModel },
        { provide: JwtService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ BREVO_API_KEY: 'k', OTP_SENDER_EMAIL: 'no-reply@x.com' })[k],
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('forgotPassword', () => {
    it('returns the same message and sends nothing for unknown emails', async () => {
      userModel.findOne.mockReturnValue({ select: () => exec(null) });
      const res = await service.forgotPassword('nobody@x.com');
      expect(res.message).toMatch(/If an account exists/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(otpModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('stores a hashed code and emails the plain code', async () => {
      userModel.findOne.mockReturnValue({ select: () => exec({ _id: 'u1' }) });
      otpModel.findOneAndUpdate.mockResolvedValue({});

      await service.forgotPassword('user@x.com');

      const stored = otpModel.findOneAndUpdate.mock.calls[0][1].code as string;
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const sentCode = /(\d{6})<\/h1>/.exec(body.htmlContent)![1];
      expect(stored).toBe(sha(sentCode));
      expect(stored).not.toContain(sentCode);
      expect(otpModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
        phoneOrEmail: 'user@x.com',
        purpose: 'reset',
      });
    });
  });

  describe('resetPassword', () => {
    const dto = {
      email: 'user@x.com',
      code: '123456',
      newPassword: 'newpass1',
    };

    it('resets the password and verifies the account with a correct code', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(
        exec({ _id: 'o1', code: sha('123456'), attempts: 1 }),
      );

      await service.resetPassword(dto);

      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(new RegExp(filter.email.$regex, filter.email.$options).test('User@X.com')).toBe(true);
      expect(update.$set.isVerified).toBe(true);
      await expect(
        bcrypt.compare('newpass1', update.$set.passwordHash),
      ).resolves.toBe(true);
      expect(otpModel.deleteOne).toHaveBeenCalledWith({ _id: 'o1' });
    });

    it('rejects a wrong code without touching the password', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(
        exec({ _id: 'o1', code: sha('999999'), attempts: 1 }),
      );
      await expect(service.resetPassword(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('destroys the code once the attempt limit is exceeded, even if correct', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(
        exec({ _id: 'o1', code: sha('123456'), attempts: 6 }),
      );
      await expect(service.resetPassword(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(otpModel.deleteOne).toHaveBeenCalledWith({ _id: 'o1' });
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when no active code exists', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(exec(null));
      await expect(service.resetPassword(dto)).rejects.toThrow(
        'Invalid or expired reset code.',
      );
    });

    it('rejects a code already consumed by a concurrent request', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(
        exec({ _id: 'o1', code: sha('123456'), attempts: 1 }),
      );
      otpModel.deleteOne.mockResolvedValue({ deletedCount: 0 });
      await expect(service.resetPassword(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });
  });
});

describe('AuthService login, register and verification', () => {
  let service: AuthService;
  let userModel: Record<string, jest.Mock>;
  let otpModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    userModel = { findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
    otpModel = { findOneAndUpdate: jest.fn(), deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('User'), useValue: userModel },
        { provide: getModelToken('Otp'), useValue: otpModel },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('finds accounts stored with different capitalisation', async () => {
    const hash = await bcrypt.hash('secret1', 4);
    userModel.findOne.mockResolvedValue({
      _id: 'u1', email: 'Chioma@X.com', role: 'seeker', isVerified: true, passwordHash: hash,
      toObject() { return { ...this }; },
    });
    const res = await service.login({ email: 'chioma@x.com', password: 'secret1' });
    expect(res.accessToken).toBe('jwt');
    const filter = userModel.findOne.mock.calls[0][0];
    expect(new RegExp(filter.email.$regex, filter.email.$options).test('Chioma@X.com')).toBe(true);
  });

  describe('verifyOtp', () => {
    const dto = { phoneOrEmail: 'chioma@x.com', code: '123456' };

    it('counts the attempt before comparing, and verifies on a correct code', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(exec({ _id: 'o1', code: '123456', attempts: 1 }));
      await service.verifyOtp(dto);
      const [filter, update] = otpModel.findOneAndUpdate.mock.calls[0];
      expect(update).toEqual({ $inc: { attempts: 1 } });
      expect(filter.purpose).toEqual({ $ne: 'reset' });
      expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
      expect(userModel.updateOne).toHaveBeenCalled();
      expect(otpModel.deleteOne).toHaveBeenCalledWith({ _id: 'o1' });
    });

    it('rejects a wrong code without verifying the account', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(exec({ _id: 'o1', code: '999999', attempts: 2 }));
      await expect(service.verifyOtp(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('destroys the code after 5 wrong attempts, even if the next guess is right', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(exec({ _id: 'o1', code: '123456', attempts: 6 }));
      await expect(service.verifyOtp(dto)).rejects.toThrow(/new code/);
      expect(otpModel.deleteOne).toHaveBeenCalledWith({ _id: 'o1' });
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when there is no active code', async () => {
      otpModel.findOneAndUpdate.mockReturnValue(exec(null));
      await expect(service.verifyOtp(dto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
