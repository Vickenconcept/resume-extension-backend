import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger';

export class FileUploadService {
  constructor() {
    const cloudinaryUrl = process.env.CLOUDINARY_URL;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (cloudinaryUrl) {
      // Parse CLOUDINARY_URL format: cloudinary://api_key:api_secret@cloud_name
      // Or use it directly if it's already configured
      cloudinary.config();
      // CLOUDINARY_URL is automatically parsed by cloudinary SDK
    } else if (cloudName && apiKey && apiSecret) {
      // Use individual credentials
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
    } else {
      throw new Error(
        'Cloudinary is not configured. Please add CLOUDINARY_URL or individual credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) to your .env file.'
      );
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'resumes',
    options: any = {}
  ): Promise<{ secure_url: string; url: string; public_id: string }> {
    try {
      const mimeType = file.mimetype;
      const isImage = mimeType.startsWith('image/');
      const isVideo = mimeType.startsWith('video/');
      const isPdf = mimeType === 'application/pdf';
      const isWord = [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ].includes(mimeType);

      // Extract extension from original filename
      const originalName = file.originalname;
      const extensionMatch = originalName.match(/\.([^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : '';
      
      // Determine final public_id
      let finalPublicId: string;
      
      if (options.public_id) {
        // If public_id is provided in options, use it but ensure it has extension
        finalPublicId = extension && !options.public_id.endsWith(`.${extension}`)
          ? `${options.public_id}.${extension}`
          : options.public_id;
      } else {
        // Generate from original filename
        const baseName = extension ? originalName.replace(/\.[^/.]+$/, '') : originalName;
        const sanitizedBaseName = baseName
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        
        finalPublicId = extension
          ? `${sanitizedBaseName || `file_${Date.now()}`}.${extension}`
          : (sanitizedBaseName || `file_${Date.now()}`);
      }

      // Determine resource type
      let resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto';
      if (isVideo) {
        resourceType = 'video';
      } else if (isImage) {
        resourceType = 'image';
      } else if (isPdf || isWord) {
        resourceType = 'raw';
      }

      const uploadOptions = {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true, // Changed to true to ensure unique filenames
        public_id: finalPublicId,
        ...Object.fromEntries(
          Object.entries(options).filter(([key]) => key !== 'public_id')
        ), // Remove public_id from options since we set it above
      };

      // Upload to Cloudinary
      const uploadResult = await cloudinary.uploader.upload(
        `data:${mimeType};base64,${file.buffer.toString('base64')}`,
        uploadOptions
      );

      return {
        secure_url: uploadResult.secure_url,
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || String(error) || 'Unknown error';
      logger.error('FileUploadService: Upload failed', {
        error: errorMessage,
        error_stack: error?.stack,
        error_type: typeof error,
        file_name: file.originalname,
        file_size: file.size,
      });
      throw new Error('Failed to upload file: ' + errorMessage);
    }
  }

  async uploadFileContent(
    fileContent: Buffer | string,
    folder: string = 'tailored-resumes',
    filename: string = 'file',
    mimeType: string = 'application/octet-stream',
    options: any = {}
  ): Promise<string> {
    try {
      const isPdf = mimeType === 'application/pdf';
      const isWord = [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ].includes(mimeType);
      const resourceType = isPdf || isWord ? 'raw' : 'auto';

      // Extract extension from filename or determine from mimeType
      const extensionMatch = filename.match(/\.([^.]+)$/);
      let extension = extensionMatch ? extensionMatch[1] : '';
      
      // If no extension in filename, determine from mimeType
      if (!extension) {
        if (isPdf) extension = 'pdf';
        else if (isWord) extension = 'docx';
      }

      // Separate base name and extension
      const baseName = extension ? filename.replace(/\.[^/.]+$/, '') : filename;
      
      // Sanitize base name (keep dots, dashes, underscores)
      const sanitizedBaseName = baseName
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      // Reconstruct public_id with extension
      const publicId = extension 
        ? `${sanitizedBaseName || `file_${Date.now()}`}.${extension}`
        : (sanitizedBaseName || `file_${Date.now()}`);

      const uploadOptions = {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true, // Changed to true to ensure unique filenames
        public_id: publicId,
        ...options,
      };

      const buffer = typeof fileContent === 'string' ? Buffer.from(fileContent) : fileContent;
      const uploadResult = await cloudinary.uploader.upload(
        `data:${mimeType};base64,${buffer.toString('base64')}`,
        uploadOptions
      );

      logger.info('File uploaded to Cloudinary', {
        folder,
        publicId,
        url: uploadResult.secure_url,
        resourceType,
      });

      return uploadResult.secure_url;
    } catch (error: any) {
      logger.error('FileUploadService: Upload content failed', { error: error.message });
      throw error;
    }
  }

  async deleteFile(publicId: string, resourceType: 'image' | 'video' | 'raw' = 'raw'): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
      return result.result === 'ok';
    } catch (error: any) {
      logger.error('FileUploadService: Delete failed', {
        public_id: publicId,
        resource_type: resourceType,
        error: error.message,
      });
      return false;
    }
  }
}
