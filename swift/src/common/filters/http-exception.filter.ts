import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // If it is a known NestJS HTTP error, get its status. Otherwise, treat it as a 500 Server Error.
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Get the error message payload
    const exceptionResponse = exception instanceof HttpException 
      ? exception.getResponse() 
      : null;

    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      message = typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).message || exception.message
        : exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
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
