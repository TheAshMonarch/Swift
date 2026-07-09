import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User } from '../users/users.schema';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { GoogleLoginDto } from './google-login.dto';
import { Otp } from './otp.schema';
import { VerifyOtpDto } from './verify-otp.dto';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Otp.name) private readonly otpModel: Model<Otp>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  // Helper method to completely strip out private fields before sending user data down
  private sanitizeUser(user: any) {
    const cleanUser = user.toObject
      ? user.toObject()
      : JSON.parse(JSON.stringify(user));
    delete cleanUser.passwordHash;
    return cleanUser;
  }

  async googleLogin(googleLoginDto: GoogleLoginDto): Promise<{
    message: string;
    accessToken: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const { token, location, role } = googleLoginDto;
    const t0 = Date.now();

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      const t1 = Date.now();
      console.log(`[googleLogin] verifyIdToken: ${t1 - t0}ms`);

      const payload = ticket.getPayload();
      if (!payload || !payload.email)
        throw new UnauthorizedException('Invalid Google token payload');
      const { email, name } = payload;

      let user = await this.userModel.findOne({ email });
      const t2 = Date.now();
      console.log(`[googleLogin] findOne: ${t2 - t1}ms`);

      if (!user) {
        const coordinates = location?.coordinates || [7.92, 5.03];
        const formattedLocation = {
          type: 'Point',
          coordinates: coordinates,
        };

        user = new this.userModel({
          name: name || 'Google User',
          email,
          phone: `google-${Date.now()}`,
          passwordHash: 'OAUTH_USER_NO_PASSWORD',
          role: role || 'seeker',
          isVerified: true,
          location: formattedLocation,
        });
        await user.save();
        const t3 = Date.now();
        console.log(`[googleLogin] save (new user): ${t3 - t2}ms`);
      }

      const jwtPayload = {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
      };

      const signStart = Date.now();
      const accessToken = this.jwtService.sign(jwtPayload);
      console.log(`[googleLogin] jwt.sign: ${Date.now() - signStart}ms`);

      console.log(`[googleLogin] TOTAL: ${Date.now() - t0}ms`);

      return {
        message: 'google login successful',
        accessToken,
        user: this.sanitizeUser(user),
      };
    } catch (error) {
      console.error('Google verify error details:', error);
      throw new UnauthorizedException('Google authentication failed');
    }
  }

  async register(
    registerDto: RegisterDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const { email, phone, password, location, ...rest } = registerDto;

    const existingUser = await this.userModel.findOne({
      $or: [{ email }, { phone }],
    });
    if (existingUser) {
      throw new ConflictException('Email or phone number already registered');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const formattedLocation = {
      type: 'Point',
      coordinates: location.coordinates,
    };

    const newUser = new this.userModel({
      ...rest,
      email,
      phone,
      passwordHash,
      location: formattedLocation,
      verified: false,
    });

    const savedUser = await newUser.save();
    await this.sendOtp(email);

    return this.sanitizeUser(savedUser);
  }

  async login(loginDto: LoginDto): Promise<{
    message: string;
    accessToken: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const { email, password } = loginDto;

    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Please verify your email address before logging in.',
      );
    }

    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    return {
      message: 'Login successful',
      accessToken: this.jwtService.sign(payload),
      user: this.sanitizeUser(user), //Returning the complete sanitized user object
    };
  }

  async sendOtp(phoneOrEmail: string): Promise<{ message: string }> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    // Mongoose update option clean up: use returnDocument instead of 'new' to clear deprecation warning
    await this.otpModel.findOneAndUpdate(
      { phoneOrEmail },
      { code, expiresAt },
      { upsert: true, returnDocument: 'after' },
    );

    //
    const brevoApiKey = this.configService.get<string>('BREVO_API_KEY');

    if (!brevoApiKey) {
      console.error(
        ' Brevo delivery skipped: BREVO_API_KEY environment variable is missing.',
      );
      return {
        message: 'Verification OTP code generated (Email config missing).',
      };
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'ARTIZ', email: 'rhemaamasi12@gmail.com' },
          to: [{ email: phoneOrEmail }],
          subject: 'Verify Your Artiz Account',
          htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
              <h2>Welcome to Artiz!</h2>
              <p>Use the following verification code to confirm your email address. It will expire in 5 minutes:</p>
              <h1 style="color: #4F46E5; letter-spacing: 4px; font-size: 32px;">${code}</h1>
              <p style="font-size: 12px; color: #666;">If you didn't create an account, please ignore this email.</p>
            </div>
          `,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(JSON.stringify(errorData));
      }

      console.log(
        `✓ Verification email sent successfully via Brevo HTTP to ${phoneOrEmail}`,
      );
    } catch (error) {
      // Log it internally so your server keeps running smoothly even if an API issue happens
      console.error('❌ Brevo HTTP email delivery failed:', error);
    }

    return { message: 'Verification OTP code dispatched successfully.' };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{ message: string }> {
    const { phoneOrEmail, code } = verifyOtpDto;

    // Search for the matching active code parameter
    const record = await this.otpModel.findOne({ phoneOrEmail, code });
    if (!record) {
      throw new BadRequestException(
        'Invalid verification code or code expired.',
      );
    }

    // Check if the current time is past the expiration mark
    if (new Date() > record.expiresAt) {
      await this.otpModel.deleteOne({ _id: record._id });
      throw new BadRequestException('Verification code has expired.');
    }

    // Set user account to verified inside your database
    await this.userModel.updateOne(
      { $or: [{ email: phoneOrEmail }, { phone: phoneOrEmail }] },
      { isVerified: true },
    );

    // Remove the OTP record since it has served its purpose
    await this.otpModel.deleteOne({ _id: record._id });

    return { message: 'Account verified successfully.' };
  }
}
