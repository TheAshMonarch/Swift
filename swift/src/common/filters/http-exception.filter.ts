import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // A malformed id that slipped past IsObjectIdPipe (e.g. a body field) is a
    // client error, not a server error. The message never includes the raw value.
    if (exception instanceof MongooseError.CastError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: [`Invalid ${exception.path}`],
      });
      return;
    }

    // Unique index violation (e.g. two sign-ups at once, or changing to a phone
    // number someone else has). Name the field, never echo the value.
    const mongo = exception as { code?: number; keyPattern?: Record<string, unknown> };
    if (mongo?.code === 11000) {
      const field = Object.keys(mongo.keyPattern ?? {})[0];
      const message =
        field === 'email'
          ? 'That email is already registered.'
          : field === 'phone'
            ? 'That phone number is already in use.'
            : 'That value is already in use.';
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: [message],
      });
      return;
    }

    // If it is a known NestJS HTTP error, get its status. Otherwise, treat it as a 500 Server Error.
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Get the error message payload
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    let message: string | string[] = 'Internal server error';
    if (exception instanceof HttpException) {
      message = typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).message || exception.message
        : exception.message;
    } else {
      // SECURITY: never leak internal Error messages (driver details, stack
      // context, duplicate-key payloads, etc.) to the client — log instead.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Always send back this exact JSON format to your frontend
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: Array.isArray(message) ? message : [message],
    });
  }
}
