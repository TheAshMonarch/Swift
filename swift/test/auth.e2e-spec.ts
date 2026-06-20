import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('AuthController (E2E)', () => {
  let app: INestApplication;
  let dbConnection: Connection;

  // Setup the test server and database connection before running tests
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // Mirror the exact global configurations from main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    
    await app.init();
    dbConnection = moduleFixture.get<Connection>(getConnectionToken());
  }, 20000);

  // Clear out the test database collections after each test run to stay clean
  // CLEANUP: Clear out database collections after EACH individual test run
  afterEach(async () => {
    // DO NOT close the app here! Just clear the collections.
    if (dbConnection && dbConnection.models['User']) {
      await dbConnection.collection('users').deleteMany({});
    }
  });

  // SHUTDOWN: Close down the app and database completely when ALL tests are finished
  afterAll(async () => {
    if (dbConnection) {
      await dbConnection.close();
    }
    if (app) {
      await app.close();
    }
  });


  const mockUser = {
    name: 'John Doe',
    email: 'john@example.com',
    password: 'password123',
    phone: '+2348012345678',
    role: 'seeker',
    location: {
      coordinates: [7.92, 5.02], // [longitude, latitude]
    },
  };

  // --- register FLOW TESTS ---
  describe('POST /auth/register', () => {
    it('should successfully register a new user and return user object without password hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(mockUser)
        .expect(201);

      expect(response.body).toHaveProperty('_id');
      expect(response.body.email).toBe(mockUser.email);
      expect(response.body.name).toBe(mockUser.name);
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should reject registration if fields fail global DTO validation checking', async () => {
      const badUser = { ...mockUser, email: 'not-an-email', password: '123' };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(badUser)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('should block duplicate registers using the same email address', async () => {
      // Register the first user
      await request(app.getHttpServer()).post('/auth/register').send(mockUser).expect(201);

      // Attempt to register again with identical email data
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(mockUser)
        .expect(409);

      expect(response.body.message[0]).toContain('already registered');
    });
  });

  // --- LOGIN FLOW TESTS ---
  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Pre-register our test user profile directly through the register path
      await request(app.getHttpServer()).post('/auth/register').send(mockUser).expect(201);
    });

      it('should authenticate user credentials and return a successful payload tracking information', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: mockUser.email,
          password: mockUser.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken'); // Look for the new JWT token field
      expect(response.body.role).toBe(mockUser.role);
      expect(response.body.message).toBe('Login successful');
    });


    it('should throw an explicit unauthorized status if password validation hashes mismatch', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: mockUser.email,
          password: 'wrongpassword',
        })
        .expect(401);
    });
  });
});
