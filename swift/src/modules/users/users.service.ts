import { Injectable } from '@nestjs/common';

/**
 * Minimal UsersService stub.
 *
 * This lightweight implementation provides safe, no-op methods so the rest
 * of the application can import `UsersService` without introducing heavy
 * dependencies while you implement the full service later.
 */
@Injectable()
export class UsersService {
  async create(_dto: any): Promise<any> {
    return null;
  }

  async findAll(_filters?: any): Promise<any[]> {
    return [];
  }

  async findByEmail(_email: string): Promise<any | null> {
    return null;
  }

  async findByEmailForAuth(_email: string): Promise<any | null> {
    return null;
  }

  async findById(_id: string): Promise<any | null> {
    return null;
  }

  async update(_id: string, _dto: any): Promise<any | null> {
    return null;
  }

  async updateLastLogin(_id: string): Promise<void> {
    return;
  }

  async addRating(_providerId: string, _rating: number): Promise<any | null> {
    return null;
  }

  async incrementCompletedJobs(_providerId: string, _earnings: number = 0): Promise<any | null> {
    return null;
  }

  async updateVerificationStatus(_id: string, _status: any, _documents?: string[]): Promise<any | null> {
    return null;
  }

  async searchProviders(_criteria: any, _limit = 20): Promise<any[]> {
    return [];
  }

  async deactivateUser(_id: string): Promise<any | null> {
    return null;
  }

  async activateUser(_id: string): Promise<any | null> {
    return null;
  }

  async getProviderStats(_providerId: string): Promise<any> {
    return {};
  }

  async addVerificationDocuments(_id: string, _documents: string[]): Promise<any | null> {
    return null;
  }
}
