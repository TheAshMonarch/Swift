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
