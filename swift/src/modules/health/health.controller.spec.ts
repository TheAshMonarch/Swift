import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConnectionStates } from 'mongoose';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const connection = { readyState: ConnectionStates.connected };
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getConnectionToken(), useValue: connection }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok when the database is connected', () => {
    connection.readyState = ConnectionStates.connected;
    expect(controller.check()).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('returns 503 when the database is not connected', () => {
    connection.readyState = ConnectionStates.disconnected;
    expect(() => controller.check()).toThrow(ServiceUnavailableException);
  });
});
