import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/test', method: 'GET' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return { status, body: json.mock.calls[0][0] };
  };

  it('maps Mongoose CastError to 400 without echoing the value', () => {
    const { status, body } = run(
      new MongooseError.CastError('ObjectId', 'not-an-id', '_id'),
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(body.message).toEqual(['Invalid _id']);
  });

  it('keeps HttpException status and wraps message in an array', () => {
    const { status, body } = run(new BadRequestException('nope'));
    expect(status).toHaveBeenCalledWith(400);
    expect(body.message).toEqual(['nope']);
  });
});

describe('HttpExceptionFilter duplicate keys', () => {
  const filter = new HttpExceptionFilter();
  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/users/me', method: 'PUT' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return { status, body: json.mock.calls[0][0] };
  };
  const dup = (field: string) =>
    Object.assign(new Error('E11000 duplicate key error'), {
      name: 'MongoServerError',
      code: 11000,
      keyPattern: { [field]: 1 },
      keyValue: { [field]: 'secret-value' },
    });

  it('maps a duplicate phone to 409 without echoing the value', () => {
    const { status, body } = run(dup('phone'));
    expect(status).toHaveBeenCalledWith(409);
    expect(body.message).toEqual(['That phone number is already in use.']);
    expect(JSON.stringify(body)).not.toContain('secret-value');
  });

  it('maps a duplicate email to 409', () => {
    expect(run(dup('email')).body.message).toEqual(['That email is already registered.']);
  });
});
