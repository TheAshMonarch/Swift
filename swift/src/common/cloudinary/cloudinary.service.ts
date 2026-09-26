import { Inject, Injectable } from '@nestjs/common';
import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';

// Reference to a file stored with type 'authenticated' — never publicly reachable.
export interface PrivateFile {
  publicId: string;
  resourceType: string;
  format: string;
}

const SIGNED_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class CloudinaryService {
  // Injecting the provider guarantees cloudinary.config() ran first.
  constructor(@Inject('CLOUDINARY') _config: unknown) {}

  upload(
    buffer: Buffer,
    options: UploadApiOptions,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(options, (error, result) => {
          if (error || !result)
            return reject(error ?? new Error('Cloudinary upload failed'));
          resolve(result);
        })
        .end(buffer);
    });
  }

  // Upload a sensitive document (ID, selfie). Only reachable via signedUrl().
  async uploadPrivate(buffer: Buffer, folder: string): Promise<PrivateFile> {
    const result = await this.upload(buffer, {
      folder,
      type: 'authenticated',
      resource_type: 'auto',
    });
    return {
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
    };
  }

  // Short-lived download link for a private file.
  signedUrl(file: PrivateFile): string {
    return cloudinary.utils.private_download_url(file.publicId, file.format, {
      type: 'authenticated',
      resource_type: file.resourceType as 'image' | 'raw' | 'video',
      expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
    });
  }
}
