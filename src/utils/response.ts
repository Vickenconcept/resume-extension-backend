import { Response } from 'express';
import { ApiResponse } from '../types';

export class ApiResponseFormatter {
  static success<T>(
    res: Response,
    data: T | null = null,
    message: string = 'Success',
    statusCode: number = 200
  ): Response {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message,
    };
    return res.status(statusCode).json(response);
  }

  static error(
    res: Response,
    error: string,
    statusCode: number = 400,
    data: any = null
  ): Response {
    const isProduction = process.env.NODE_ENV === 'production';
    const safeError = isProduction && statusCode >= 500 ? 'Internal server error' : error;
    const response: ApiResponse = {
      success: false,
      error: safeError,
      message: safeError,
      data,
    };
    return res.status(statusCode).json(response);
  }
}
