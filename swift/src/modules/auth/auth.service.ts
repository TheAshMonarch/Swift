import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
import { Otp } from './otp.schema'; // Import Otp Schema
import { VerifyOtpDto } from './verify-otp.dto';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Otp.name) private readonly otpModel: Model<Otp>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService, // Inject ConfigService
  ) {
    // Initialize the Google verifier client
    this.googleClient = new OAuth2Client(this.configService.get<string>('GOOGLE_CLIENT_ID'));
  }

  async googleLogin(googleLoginDto: GoogleLoginDto): Promise<{message: string; accessToken: string; role: string }>{
    const { token, location } = googleLoginDto;

    try{
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();
      if(!payload || !payload.email) throw new UnauthorizedException('Invalid Google token payload');
      const { email, name } = payload;

      let user = await this.userModel.findOne({ email });

      if(!user){
        const formattedLocation = {
          type: 'Point',
          coordinates: location.coordinates,
        };

        user = new this.userModel({
          name: name || 'Google User',
          email,
          phone:`google-${Date.now()}`,
          passwordHash: 'OAUTH_USER_NO_PASSWORD',
          role: 'seeker',
          isVerified: true,
          location: formattedLocation,
        });
        await user.save();
      }

      const jwtPayload = { sub:  user._id.toString(), email: user.email, role: user.role };

      return {
        message: "google login successful",
        accessToken: this.jwtService.sign(jwtPayload),
        role: user.role,
      };
    }catch(error){
      throw new UnauthorizedException('Google authentication failed');
    }
  }

  async register(registerDto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    const { email, phone, password, location, ...rest } = registerDto;

    // Check if user already exists
    const existingUser = await this.userModel.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      throw new ConflictException('Email or phone number already registered');
    }

    // Hash the password safely
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);


    // Format location for MongoDB GeoJSON
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
    });

    const savedUser = await newUser.save();
    
    const cleanUser = JSON.parse(JSON.stringify(savedUser));

    delete cleanUser.passwordHash;
    delete cleanUser.password;

    // Hide passwordHash in the return object
    return cleanUser;
  }

  async login(loginDto: LoginDto): Promise<{ message: string; accessToken: string; role: string }> {
    const { email, password } = loginDto;

    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Set up what information stays packed safely inside the client token
    const payload = { sub: user._id.toString(), email: user.email, role: user.role };

    return {
      message: 'Login successful',
      accessToken: this.jwtService.sign(payload), // Signs token with config options
      role: user.role,
    };
  }

  async sendOtp(phoneOrEmail: string): Promise<{ message: string }>{

    const code = Math.floor(100000 + Math.random() * 90000).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    await this.otpModel.findOneAndUpdate(
      { phoneOrEmail },
      { code, expiresAt },
      { upsert: true, new: true }
    );

    // MOCK SEND LOGS: This mimics a live Termii / Twilio / SendGrid hook channel
    console.log(`\n--- SWIFT MOCK NOTIFICATION SYSTEM ---`);
    console.log(`[SENDING TO]: ${phoneOrEmail}`);
    console.log(`[OTP VERIFICATION CODE]: ${code}`);
    console.log(`-----------------------------------------\n`);

    return { message: 'Verification OTP code dispatched successfully.' };          
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{ message: string }> {
    const { phoneOrEmail, code } = verifyOtpDto;

    // Search for the matching active code parameter
    const record = await this.otpModel.findOne({ phoneOrEmail, code });
    if (!record) {
      throw new BadRequestException('Invalid verification code or code expired.');
    }

    // Check if the current time is past the expiration mark
    if (new Date() > record.expiresAt) {
      await this.otpModel.deleteOne({ _id: record._id });
      throw new BadRequestException('Verification code has expired.');
    }

    // Set user account to verified inside your database
    await this.userModel.updateOne(
      { $or: [{ email: phoneOrEmail }, { phone: phoneOrEmail }] },
      { isVerified: true }
    );

    // Remove the OTP record since it has served its purpose
    await this.otpModel.deleteOne({ _id: record._id });

    return { message: 'Account verified successfully.' };
  }
}
