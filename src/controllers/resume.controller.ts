import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';
import { OpenAIService } from '../services/openai.service';
import { ResumeParserService } from '../services/resumeParser.service';
import { FileUploadService } from '../services/fileUpload.service';
import { DocumentService } from '../services/document.service';

const prisma = new PrismaClient();
const openAIService = new OpenAIService();
const resumeParserService = new ResumeParserService();
const fileUploadService = new FileUploadService();
const documentService = new DocumentService();

export class ResumeController {
  async upload(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        ApiResponseFormatter.error(res, 'Resume file is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;
      const file = req.file;
      const resumeId = `resume_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Allow multiple resumes - check if this should be set as default
      // If user has no resumes, this will be default
      const existingResumesCount = await prisma.resume.count({
        where: { userId: user.id },
      });
      
      const isDefault = existingResumesCount === 0; // First resume is default

      // Upload to Cloudinary
      const uploadResult = await fileUploadService.uploadFile(file, 'resumes', {
        public_id: `resume_${resumeId}`,
      });

      // Parse resume content
      const resumeContent = await resumeParserService.parse(file);

      // If this is the first resume, unset other defaults
      if (isDefault) {
        await prisma.resume.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      // Save to database
      const resume = await prisma.resume.create({
        data: {
          userId: user.id,
          resumeId,
          filename: file.originalname,
          displayName: file.originalname.replace(/\.[^/.]+$/, ''), // Use filename without extension as display name
          cloudinaryUrl: uploadResult.secure_url,
          cloudinaryPublicId: uploadResult.public_id,
          parsedContent: resumeContent as any,
          isDefault,
        },
      });

      ApiResponseFormatter.success(
        res,
        {
          resumeId,
          cloudinaryUrl: uploadResult.secure_url,
          filename: file.originalname,
          uploadedAt: resume.createdAt.toISOString(),
        },
        'Resume uploaded successfully'
      );
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || String(error) || 'Unknown error';
      logger.error('Resume upload error:', {
        error: errorMessage,
        error_stack: error?.stack,
        error_type: typeof error,
        full_error: error,
      });
      ApiResponseFormatter.error(res, 'Failed to upload resume: ' + errorMessage, 500);
    }
  }

  async tailor(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    logger.info('Resume tailoring started', {
      timestamp: new Date().toISOString(),
      start_time: startTime,
    });

    try {
      const { resumeId, jobDescription, generateFreely } = req.body;

      if (!resumeId || !jobDescription) {
        ApiResponseFormatter.error(res, 'Resume ID and job description are required', 422);
        return;
      }

      if (jobDescription.length < 50) {
        ApiResponseFormatter.error(res, 'Job description must be at least 50 characters', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;
      const generateFreelyMode = generateFreely === true || generateFreely === 'true';

      // Load resume from database
      const dbStartTime = Date.now();
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume || !resume.parsedContent) {
        ApiResponseFormatter.error(res, 'Resume not found. Please upload your resume first.', 404);
        return;
      }

      const resumeContent = resume.parsedContent as any;
      const dbTime = Date.now();

      logger.info('Database query completed', {
        duration_ms: dbTime - dbStartTime,
        total_elapsed_ms: dbTime - startTime,
      });

      // Generate tailored content using OpenAI
      const openAiStartTime = Date.now();
      logger.info('Calling OpenAI API', {
        resume_id: resumeId,
        job_description_length: jobDescription.length,
        generate_freely: generateFreelyMode,
        mode: generateFreelyMode ? 'flexible' : 'strict',
        elapsed_ms: openAiStartTime - startTime,
      });

      const tailoredContent = await openAIService.tailorResume(
        resumeContent,
        jobDescription,
        generateFreelyMode
      );

      const openAiTime = Date.now();

      // Get structured data and cover letter
      const structuredData = tailoredContent.structured || null;
      const fullTailoredResume = tailoredContent.fullResume || '';
      const coverLetter = tailoredContent.coverLetter || '';

      // Generate documents
      const docGenStartTime = Date.now();
      logger.info('Generating tailored resume documents...');

      let docxContent: Buffer;
      let pdfContent: Buffer | null = null;
      let pdfUrl: string | null = null;

      // Prefer full text over structured data (full text contains ALL content)
      // Use structured data only if full text is not available
      const resumeText = fullTailoredResume || resumeContent.raw_text || '';

      if (resumeText && resumeText.trim().length > 0) {
        // Use text-based generation (preserves ALL content including PROJECT HIGHLIGHTS, LANGUAGE, etc.)
        logger.info('Using text-based generation from fullTailoredResume');
        docxContent = await documentService.generateDocxFromText(resumeText);
        
        // Try to generate PDF (optional - may fail if Chromium not available)
        try {
          pdfContent = await documentService.generatePdfFromText(resumeText);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed (continuing with DOCX only):', {
            error: pdfError?.message || String(pdfError),
          });
          pdfContent = null;
        }
      } else if (structuredData) {
        // Fallback to structured data if no text available
        logger.warn('Using structured data generation - full text not available');
        docxContent = await documentService.generateDocxFromStructured(structuredData);
        
        try {
          pdfContent = await documentService.generatePdfFromStructured(structuredData);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed (continuing with DOCX only):', {
            error: pdfError?.message || String(pdfError),
          });
          pdfContent = null;
        }
      } else {
        throw new Error('No resume content available for document generation');
      }

      // Upload DOCX to Cloudinary
      const docxUrl = await fileUploadService.uploadFileContent(
        docxContent,
        'tailored-resumes',
        `tailored_${resumeId}_${Date.now()}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      // Upload PDF to Cloudinary (if generated)
      if (pdfContent) {
        try {
          pdfUrl = await fileUploadService.uploadFileContent(
            pdfContent,
            'tailored-resumes',
            `tailored_${resumeId}_${Date.now()}.pdf`,
            'application/pdf'
          );
        } catch (uploadError: any) {
          logger.warn('PDF upload failed:', {
            error: uploadError?.message || String(uploadError),
          });
          pdfUrl = null;
        }
      }

      // Save URLs to database
      const downloadUrls: any = {
        docx: docxUrl,
      };
      if (pdfUrl) {
        downloadUrls.pdf = pdfUrl;
      }

      await prisma.resume.update({
        where: { id: resume.id },
        data: {
          downloadUrls: downloadUrls as any,
          tailoredDocxUrl: docxUrl,
          tailoredPdfUrl: pdfUrl || null,
          tailoredResumeText: fullTailoredResume,
          coverLetter,
        },
      });

      const docGenTime = Date.now();
      const totalTime = Date.now();

      logger.info('Resume tailoring completed', {
        openai_duration_ms: openAiTime - openAiStartTime,
        document_generation_ms: docGenTime - docGenStartTime,
        total_duration_ms: totalTime - startTime,
        total_duration_seconds: (totalTime - startTime) / 1000,
      });

      ApiResponseFormatter.success(
        res,
        {
          fullDocument: fullTailoredResume,
          coverLetter,
          downloadUrls,
        },
        'Resume tailored successfully'
      );
    } catch (error: any) {
      logger.error('Resume tailor error:', error);
      ApiResponseFormatter.error(res, 'Failed to tailor resume: ' + error.message, 500);
    }
  }

  async getCurrentResume(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      // Get default resume, or first resume if no default
      const resume = await prisma.resume.findFirst({
        where: {
          userId: req.user.id,
          isDefault: true,
        },
        orderBy: { createdAt: 'desc' },
      }) || await prisma.resume.findFirst({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'No resume uploaded yet', 404);
        return;
      }

      // Get current version (if exists)
      const currentVersion = await prisma.resumeVersion.findFirst({
        where: {
          resumeId: resume.id,
          isCurrent: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

      ApiResponseFormatter.success(
        res,
        {
          resumeId: resume.resumeId,
          filename: resume.filename,
          displayName: resume.displayName || resume.filename,
          cloudinaryUrl: resume.cloudinaryUrl,
          isDefault: resume.isDefault,
          uploadedAt: resume.createdAt.toISOString(),
          currentVersion: currentVersion ? {
            tailoredResumeText: currentVersion.tailoredResumeText,
            coverLetter: currentVersion.coverLetter,
            updatedAt: currentVersion.updatedAt.toISOString(),
          } : null,
        },
        'Resume retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get resume error:', error);
      ApiResponseFormatter.error(res, 'Failed to get resume: ' + error.message, 500);
    }
  }

  // Get all resumes for a user with pagination
  async getAllResumes(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const [resumes, total] = await Promise.all([
        prisma.resume.findMany({
          where: { userId: req.user.id },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
          ],
          skip,
          take: limit,
          include: {
            versions: {
              where: { isCurrent: true },
              take: 1,
              orderBy: { updatedAt: 'desc' },
            },
          },
        }),
        prisma.resume.count({
          where: { userId: req.user.id },
        }),
      ]);

      const totalPages = Math.ceil(total / limit);

      ApiResponseFormatter.success(
        res,
        {
          resumes: resumes.map(resume => ({
            id: resume.id,
            resumeId: resume.resumeId,
            filename: resume.filename,
            displayName: resume.displayName || resume.filename,
            cloudinaryUrl: resume.cloudinaryUrl,
            isDefault: resume.isDefault,
            folder: resume.folder,
            uploadedAt: resume.createdAt.toISOString(),
            updatedAt: resume.updatedAt.toISOString(),
            hasTailoredContent: !!resume.tailoredResumeText,
            currentVersion: resume.versions[0] ? {
              updatedAt: resume.versions[0].updatedAt.toISOString(),
            } : null,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        },
        'Resumes retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get all resumes error:', error);
      ApiResponseFormatter.error(res, 'Failed to get resumes: ' + error.message, 500);
    }
  }

  // Set default resume
  async setDefaultResume(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId } = req.body;

      if (!resumeId) {
        ApiResponseFormatter.error(res, 'Resume ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      // Unset all other defaults
      await prisma.resume.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });

      // Set this resume as default
      await prisma.resume.update({
        where: { id: resume.id },
        data: { isDefault: true },
      });

      ApiResponseFormatter.success(res, null, 'Default resume updated successfully');
    } catch (error: any) {
      logger.error('Set default resume error:', error);
      ApiResponseFormatter.error(res, 'Failed to set default resume: ' + error.message, 500);
    }
  }

  // Update resume name
  async updateResumeName(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId, displayName } = req.body;

      logger.info('Update resume name request:', { resumeId, displayName, body: req.body });

      if (!resumeId) {
        ApiResponseFormatter.error(res, 'Resume ID is required', 422);
        return;
      }

      if (!displayName || displayName.trim().length === 0) {
        ApiResponseFormatter.error(res, 'Display name is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      const trimmedName = displayName.trim();
      logger.info('Updating resume name:', { resumeId: resume.id, oldName: resume.displayName, newName: trimmedName });

      const updated = await prisma.resume.update({
        where: { id: resume.id },
        data: { displayName: trimmedName },
      });

      logger.info('Resume name updated successfully:', { resumeId: updated.resumeId, displayName: updated.displayName });

      ApiResponseFormatter.success(res, { displayName: updated.displayName }, 'Resume name updated successfully');
    } catch (error: any) {
      logger.error('Update resume name error:', error);
      ApiResponseFormatter.error(res, 'Failed to update resume name: ' + error.message, 500);
    }
  }

  // Delete resume
  async deleteResume(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId } = req.body;

      if (!resumeId) {
        ApiResponseFormatter.error(res, 'Resume ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      // Don't allow deleting if it's the only resume
      const resumeCount = await prisma.resume.count({
        where: { userId: user.id },
      });

      if (resumeCount <= 1) {
        ApiResponseFormatter.error(res, 'Cannot delete the only resume. Please upload a new one first.', 400);
        return;
      }

      // Delete from Cloudinary
      try {
        await fileUploadService.deleteFile(resume.cloudinaryPublicId, 'raw');
        if (resume.tailoredDocxUrl) {
          // Extract public_id from Cloudinary URL if possible
          const docxMatch = resume.tailoredDocxUrl.match(/\/v\d+\/(.+)\.[^.]+$/);
          if (docxMatch) {
            await fileUploadService.deleteFile(docxMatch[1], 'raw');
          }
        }
        if (resume.tailoredPdfUrl) {
          const pdfMatch = resume.tailoredPdfUrl.match(/\/v\d+\/(.+)\.[^.]+$/);
          if (pdfMatch) {
            await fileUploadService.deleteFile(pdfMatch[1], 'raw');
          }
        }
      } catch (e: any) {
        logger.warn('Failed to delete files from Cloudinary:', e);
      }

      // Delete resume (cascades to versions)
      await prisma.resume.delete({
        where: { id: resume.id },
      });

      // If deleted resume was default, set another one as default
      const remainingResume = await prisma.resume.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      if (remainingResume) {
        await prisma.resume.update({
          where: { id: remainingResume.id },
          data: { isDefault: true },
        });
      }

      ApiResponseFormatter.success(res, null, 'Resume deleted successfully');
    } catch (error: any) {
      logger.error('Delete resume error:', error);
      ApiResponseFormatter.error(res, 'Failed to delete resume: ' + error.message, 500);
    }
  }

  async download(req: Request, res: Response): Promise<void> {
    try {
      // Support both query params (GET-style) and body (POST-style)
      const resumeId = (req.body?.resumeId || req.query?.resumeId) as string;
      const format = (req.body?.format || req.query?.format || 'docx') as string;
      const content = req.body?.content;

      if (!resumeId || typeof resumeId !== 'string') {
        ApiResponseFormatter.error(res, 'Resume ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;
      const downloadFormat = (format as string) || 'docx';

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      // Determine which content to use:
      // 1. Content from request body (edited content from textareas) - highest priority
      // 2. Saved content from database - fallback
      let resumeText = '';
      
      logger.info('Download request received', {
        hasContent: !!content,
        contentKeys: content ? Object.keys(content) : [],
        hasFullResume: !!(content?.fullResume),
        hasFullDocument: !!(content?.fullDocument),
        hasTailoredResumeText: !!resume.tailoredResumeText,
        format: downloadFormat,
      });
      
      if (content && (content.fullResume || content.fullDocument)) {
        // Use content from request (edited content from textareas)
        resumeText = content.fullResume || content.fullDocument || '';
        logger.info('Using edited content from request', {
          contentLength: resumeText.length,
          hasFullResume: !!content.fullResume,
          hasFullDocument: !!content.fullDocument,
          format: downloadFormat,
          preview: resumeText.substring(0, 100),
        });
      } else if (resume.tailoredResumeText) {
        // Use saved content from database
        resumeText = resume.tailoredResumeText;
        logger.info('Using saved content from database', {
          contentLength: resumeText.length,
          format: downloadFormat,
        });
      } else {
        // Fallback to pre-generated file from Cloudinary
        logger.info('No content available, using pre-generated file from Cloudinary');
        const downloadUrls = resume.downloadUrls as any;
        const downloadUrl =
          downloadFormat === 'pdf'
            ? resume.tailoredPdfUrl || downloadUrls?.pdf
            : resume.tailoredDocxUrl || downloadUrls?.docx;

        if (!downloadUrl) {
          ApiResponseFormatter.error(
            res,
            'Download URL not found. Please generate tailored content first.',
            404
          );
          return;
        }

        // Fetch file from Cloudinary URL
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch file from storage');
        }

        const fileContent = Buffer.from(await response.arrayBuffer());
        const filename = `tailored-resume-${new Date().toISOString().split('T')[0]}.${downloadFormat}`;
        const contentType =
          downloadFormat === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', fileContent.length.toString());
        res.send(fileContent);
        return;
      }
      
      // Generate documents with the determined content
      let fileContent: Buffer;
      if (downloadFormat === 'docx') {
        fileContent = await documentService.generateDocxFromText(resumeText);
      } else {
        try {
          fileContent = await documentService.generatePdfFromText(resumeText);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed, falling back to DOCX:', pdfError);
          fileContent = await documentService.generateDocxFromText(resumeText);
          // Change format to docx if PDF fails
          const filename = `tailored-resume-${new Date().toISOString().split('T')[0]}.docx`;
          const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', fileContent.length.toString());
          res.send(fileContent);
          return;
        }
      }

      // Create a version record for this download
      try {
        // Unset other current versions for this resume
        await prisma.resumeVersion.updateMany({
          where: { resumeId: resume.id, isCurrent: true },
          data: { isCurrent: false },
        });

        // Create new version record
        const versionName = `Downloaded ${new Date().toLocaleDateString()} - ${downloadFormat.toUpperCase()}`;
        await prisma.resumeVersion.create({
          data: {
            resumeId: resume.id,
            versionName,
            tailoredResumeText: resumeText,
            coverLetter: resume.coverLetter || null,
            tailoredDocxUrl: downloadFormat === 'docx' ? null : resume.tailoredDocxUrl, // Will be set if regenerated
            tailoredPdfUrl: downloadFormat === 'pdf' ? null : resume.tailoredPdfUrl, // Will be set if regenerated
            isCurrent: true,
          },
        });

        logger.info('Version record created for download', {
          resumeId: resume.resumeId,
          format: downloadFormat,
          versionName,
        });
      } catch (versionError: any) {
        logger.warn('Failed to create version record (continuing with download):', versionError);
        // Don't fail the download if version creation fails
      }

      // Send the generated file
      const filename = `tailored-resume-${new Date().toISOString().split('T')[0]}.${downloadFormat}`;
      const contentType =
        downloadFormat === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', fileContent.length.toString());
      res.send(fileContent);
    } catch (error: any) {
      logger.error('Resume download error:', error);
      ApiResponseFormatter.error(res, 'Failed to download resume: ' + error.message, 500);
    }
  }

  async updateTailoredContent(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId, tailoredResumeText, coverLetter } = req.body;

      if (!resumeId) {
        ApiResponseFormatter.error(res, 'Resume ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      // Update main resume record
      const updateData: any = {};
      if (tailoredResumeText !== undefined) {
        updateData.tailoredResumeText = tailoredResumeText;
        updateData.tailoredDocxUrl = null;
        updateData.tailoredPdfUrl = null;
        updateData.downloadUrls = null;
      }
      if (coverLetter !== undefined) {
        updateData.coverLetter = coverLetter;
      }

      if (Object.keys(updateData).length === 0) {
        ApiResponseFormatter.error(res, 'No content provided to update', 422);
        return;
      }

      await prisma.resume.update({
        where: { id: resume.id },
        data: updateData,
      });

      // Update or create current version
      const existingVersion = await prisma.resumeVersion.findFirst({
        where: {
          resumeId: resume.id,
          isCurrent: true,
        },
      });

      if (existingVersion) {
        await prisma.resumeVersion.update({
          where: { id: existingVersion.id },
          data: {
            tailoredResumeText: tailoredResumeText !== undefined ? tailoredResumeText : existingVersion.tailoredResumeText,
            coverLetter: coverLetter !== undefined ? coverLetter : existingVersion.coverLetter,
            tailoredDocxUrl: null,
            tailoredPdfUrl: null,
            downloadUrls: null,
          },
        });
      } else if (tailoredResumeText) {
        // Unset other current versions for this resume
        await prisma.resumeVersion.updateMany({
          where: { resumeId: resume.id, isCurrent: true },
          data: { isCurrent: false },
        });

        // Create new current version
        await prisma.resumeVersion.create({
          data: {
            resumeId: resume.id,
            tailoredResumeText: tailoredResumeText,
            coverLetter: coverLetter || null,
            isCurrent: true,
          },
        });
      }

      // Update resume in database
      await prisma.resume.update({
        where: { id: resume.id },
        data: updateData,
      });

      ApiResponseFormatter.success(
        res,
        { updated: Object.keys(updateData) },
        'Content updated successfully'
      );
    } catch (error: any) {
      logger.error('Update tailored content error:', error);
      ApiResponseFormatter.error(res, 'Failed to update content: ' + error.message, 500);
    }
  }
}
