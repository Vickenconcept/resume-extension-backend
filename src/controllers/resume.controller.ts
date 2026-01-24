import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';
import { OpenAIService } from '../services/openai.service';
import { ResumeParserService } from '../services/resumeParser.service';
import { FileUploadService } from '../services/fileUpload.service';
import { DocumentService } from '../services/document.service';
import { QualityService } from '../services/quality.service';

const prisma = new PrismaClient();
const openAIService = new OpenAIService();
const resumeParserService = new ResumeParserService();
const fileUploadService = new FileUploadService();
const documentService = new DocumentService();

export class ResumeController {
  /**
   * Get user's default template preference
   */
  private async getUserTemplate(userId: number): Promise<'classic' | 'modern' | 'compact'> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { defaultTemplate: true },
      });
      return (user?.defaultTemplate as 'classic' | 'modern' | 'compact') || 'classic';
    } catch (error) {
      logger.warn('Failed to get user template, defaulting to classic:', error);
      return 'classic';
    }
  }

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

      // Upload to Cloudinary - use resumeId directly (it already has "resume_" prefix)
      const uploadResult = await fileUploadService.uploadFile(file, 'resumes', {
        public_id: resumeId, // Don't add "resume_" again, it's already in resumeId
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

      // Extract parsing quality for response
      const parsingQuality = (resumeContent as any).parsingQuality;

      ApiResponseFormatter.success(
        res,
        {
          resumeId,
          cloudinaryUrl: uploadResult.secure_url,
          filename: file.originalname,
          uploadedAt: resume.createdAt.toISOString(),
          parsingQuality: parsingQuality || null,
        },
        parsingQuality && !parsingQuality.isValid
          ? 'Resume uploaded but parsing quality is low. Please review and correct if needed.'
          : 'Resume uploaded successfully'
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

      // Quality validation and similarity scoring
      const qualityService = new QualityService();

      // Calculate similarity metrics using AI-powered semantic analysis FIRST
      // so we can align the quality keyword score with ATS keyword coverage
      const originalResumeText = resumeContent.raw_text || '';
      const similarityMetrics = await qualityService.calculateSimilarity(
        fullTailoredResume || originalResumeText,
        jobDescription,
        generateFreelyMode // Pass the mode so AI can adjust scoring
      );

      // Then validate content quality
      const qualityScore = qualityService.validateContent(
        resumeContent,
        fullTailoredResume,
        jobDescription,
        generateFreelyMode
      );

      // Align quality keywordMatch with ATS keywordCoverage for a consistent UX
      if (similarityMetrics && typeof similarityMetrics.keywordCoverage === 'number') {
        (qualityScore as any).keywordMatch = Math.round(
          Math.min(100, Math.max(0, similarityMetrics.keywordCoverage))
        );

        // Recompute overall score using the existing weighting:
        // truthfulness 40% / completeness 30% / keywordMatch 30%
        const truth = (qualityScore as any).truthfulness || 0;
        const comp = (qualityScore as any).completeness || 0;
        const kw = (qualityScore as any).keywordMatch || 0;
        (qualityScore as any).overall = Math.round(truth * 0.4 + comp * 0.3 + kw * 0.3);
      }

      // Generate documents
      const docGenStartTime = Date.now();
      logger.info('Generating tailored resume documents...');

      // Get user's template preference
      const template = await this.getUserTemplate(user.id);

      let docxContent: Buffer;
      let pdfContent: Buffer | null = null;
      let pdfUrl: string | null = null;

      // Prefer full text over structured data (full text contains ALL content)
      // Use structured data only if full text is not available
      const resumeText = fullTailoredResume || resumeContent.raw_text || '';

      if (resumeText && resumeText.trim().length > 0) {
        // Use text-based generation (preserves ALL content including PROJECT HIGHLIGHTS, LANGUAGE, etc.)
        logger.info('Using text-based generation from fullTailoredResume');
        docxContent = await documentService.generateDocxFromText(resumeText, template);
        
        // Try to generate PDF (optional - may fail if Chromium not available)
        try {
          pdfContent = await documentService.generatePdfFromText(resumeText, template);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed (continuing with DOCX only):', {
            error: pdfError?.message || String(pdfError),
          });
          pdfContent = null;
        }
      } else if (structuredData) {
        // Fallback to structured data if no text available
        logger.warn('Using structured data generation - full text not available');
        docxContent = await documentService.generateDocxFromStructured(structuredData, template);
        
        try {
          pdfContent = await documentService.generatePdfFromStructured(structuredData, template);
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
      const timestamp = Date.now();
      const docxUrl = await fileUploadService.uploadFileContent(
        docxContent,
        'tailored-resumes',
        `tailored_${resumeId}_${timestamp}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      // Upload PDF to Cloudinary (if generated)
      if (pdfContent) {
        try {
          pdfUrl = await fileUploadService.uploadFileContent(
            pdfContent,
            'tailored-resumes',
            `tailored_${resumeId}_${timestamp}.pdf`,
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

      // Prepare update data - use type assertion to bypass TypeScript errors
      // until Prisma client is regenerated
      const updateData = {
        downloadUrls: downloadUrls as any,
        tailoredDocxUrl: docxUrl,
        tailoredPdfUrl: pdfUrl || null,
        tailoredResumeText: fullTailoredResume,
        coverLetter,
        qualityScore: qualityScore as any,
        similarityMetrics: similarityMetrics as any,
      } as any; // Type assertion to allow fields that exist in DB but not yet in Prisma client

      await prisma.resume.update({
        where: { id: resume.id },
        data: updateData,
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
          qualityScore,
          similarityMetrics,
        },
        'Resume tailored successfully'
      );
    } catch (error: any) {
      logger.error('Resume tailor error:', error);
      ApiResponseFormatter.error(res, 'Failed to tailor resume: ' + error.message, 500);
    }
  }

  /**
   * Regenerate resume with focused prompt to add missing keywords and achieve 98-100% match
   */
  async regenerate(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    logger.info('Resume regeneration started', {
      timestamp: new Date().toISOString(),
      start_time: startTime,
    });

    try {
      const { resumeId, jobDescription, generateFreely, missingKeywords, currentResumeText, matchedKeywords } = req.body;

      if (!resumeId || !jobDescription) {
        ApiResponseFormatter.error(res, 'Resume ID and job description are required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;
      const generateFreelyMode = generateFreely === true || generateFreely === 'true';

      // Load resume from database
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

      // Use current resume text if provided (edited version), otherwise use original
      const baseResumeText = currentResumeText || resumeContent.raw_text || '';

      logger.info('Regenerating resume with focused prompt', {
        resume_id: resumeId,
        missing_keywords_count: missingKeywords?.length || 0,
        missing_keywords: missingKeywords || [],
        generate_freely: generateFreelyMode,
      });

      // Regenerate with focused prompt that emphasizes adding missing keywords
      // Pass matched keywords to ensure they are preserved
      const tailoredContent = await openAIService.regenerateResume(
        resumeContent,
        baseResumeText,
        jobDescription,
        generateFreelyMode,
        missingKeywords || [],
        matchedKeywords || []
      );

      const openAiTime = Date.now();

      // Get structured data and cover letter
      const structuredData = tailoredContent.structured || null;
      const fullTailoredResume = tailoredContent.fullResume || '';
      const coverLetter = tailoredContent.coverLetter || '';

      // Validate that we have content
      if (!fullTailoredResume || fullTailoredResume.trim().length === 0) {
        logger.error('Regenerated resume is empty', {
          hasStructured: !!structuredData,
          hasFullResume: !!tailoredContent.fullResume,
          fullResumeLength: tailoredContent.fullResume?.length || 0
        });
        throw new Error('Regenerated resume content is empty. Please try again.');
      }

      if (!coverLetter || coverLetter.trim().length === 0) {
        logger.warn('Regenerated cover letter is empty');
      }

      // Quality validation and similarity scoring
      const qualityService = new QualityService();

      // Calculate similarity metrics FIRST so we can keep keyword-related
      // scoring consistent between ATS Match and Quality score
      const similarityMetrics = await qualityService.calculateSimilarity(
        fullTailoredResume,
        jobDescription,
        generateFreelyMode
      );

      // Then validate overall content quality
      const qualityScore = qualityService.validateContent(
        resumeContent,
        fullTailoredResume,
        jobDescription,
        generateFreelyMode
      );

      // Align quality keywordMatch with ATS keywordCoverage
      if (similarityMetrics && typeof similarityMetrics.keywordCoverage === 'number') {
        (qualityScore as any).keywordMatch = Math.round(
          Math.min(100, Math.max(0, similarityMetrics.keywordCoverage))
        );

        // Recompute overall score using the existing weighting
        const truth = (qualityScore as any).truthfulness || 0;
        const comp = (qualityScore as any).completeness || 0;
        const kw = (qualityScore as any).keywordMatch || 0;
        (qualityScore as any).overall = Math.round(truth * 0.4 + comp * 0.3 + kw * 0.3);
      }

      // Verify that missing keywords were added AND matched keywords were preserved
        const resumeLower = fullTailoredResume.toLowerCase();
      let allMissingAdded = true;
      let allMatchedPreserved = true;
      const addedKeywords: string[] = []; // Track which missing keywords were successfully added
      
      if (missingKeywords && missingKeywords.length > 0) {
        const stillMissing: string[] = [];
        
        missingKeywords.forEach((kw: string) => {
          const kwLower = kw.toLowerCase();
          // Check if keyword appears in resume (exact match or as part of a word)
          if (resumeLower.includes(kwLower)) {
            addedKeywords.push(kw);
          } else {
            stillMissing.push(kw);
            allMissingAdded = false;
          }
        });

        logger.info('Keyword verification after regeneration', {
          total_missing_keywords: missingKeywords.length,
          added_keywords: addedKeywords.length,
          added: addedKeywords,
          still_missing: stillMissing.length,
          still_missing_list: stillMissing
        });

        if (stillMissing.length > 0) {
          logger.warn('Some missing keywords were not explicitly added', {
            still_missing: stillMissing,
            note: 'AI may have used semantic alternatives'
          });
        }
      }

      // CRITICAL: Verify that matched keywords are still present
      if (matchedKeywords && matchedKeywords.length > 0) {
        const preservedKeywords: string[] = [];
        const lostKeywords: string[] = [];
        
        matchedKeywords.forEach((kw: string) => {
          const kwLower = kw.toLowerCase();
          // Check if keyword appears in resume (exact match or as part of a word)
          if (resumeLower.includes(kwLower)) {
            preservedKeywords.push(kw);
          } else {
            lostKeywords.push(kw);
            allMatchedPreserved = false;
          }
        });

        logger.info('Matched keywords preservation check after regeneration', {
          total_matched_keywords: matchedKeywords.length,
          preserved_keywords: preservedKeywords.length,
          preserved: preservedKeywords,
          lost_keywords: lostKeywords.length,
          lost: lostKeywords
        });

        if (lostKeywords.length > 0) {
          logger.warn('Some matched keywords were lost during regeneration', {
            lost_keywords: lostKeywords,
            note: 'Regeneration should preserve all existing matched keywords'
          });
        }
      }

      // Only boost to 100% if BOTH conditions are met:
      // 1. All missing keywords were added
      // 2. All matched keywords were preserved
      if (allMissingAdded && allMatchedPreserved && 
          (!missingKeywords || missingKeywords.length === 0 || 
           (missingKeywords.length > 0 && matchedKeywords && matchedKeywords.length > 0))) {
        logger.info('All requested missing keywords added AND all matched keywords preserved. Boosting match scores to 100%.');

        // Force ATS similarity and keyword coverage to 100 for this regeneration
        (similarityMetrics as any).similarityScore = 100;
        (similarityMetrics as any).keywordCoverage = 100;
        (similarityMetrics as any).missingKeywords = [];

        // Build comprehensive matched keywords list:
        // 1. All originally matched keywords (preserved)
        // 2. All newly added missing keywords (now matched)
        // 3. Any additional matches from fresh ATS analysis
        const comprehensiveMatched: string[] = [];
        
        // Add preserved matched keywords
        if (matchedKeywords && matchedKeywords.length > 0) {
          comprehensiveMatched.push(...matchedKeywords);
        }
        
        // Add newly added missing keywords (they're now matched!)
        if (addedKeywords.length > 0) {
          comprehensiveMatched.push(...addedKeywords);
        }
        
        // Merge with any new matches from fresh ATS analysis
        const atsMatched = (similarityMetrics as any).matchedKeywords || [];
        const allMatched = [...new Set([...comprehensiveMatched, ...atsMatched])];
        
        // Set the comprehensive matched keywords list
        (similarityMetrics as any).matchedKeywords = allMatched;
        
        logger.info('Comprehensive matched keywords list created', {
          preserved_matched: matchedKeywords?.length || 0,
          newly_added: missingKeywords?.length || 0,
          ats_found: atsMatched.length,
          total_matched: allMatched.length,
          matched_keywords: allMatched
        });

        // Also reflect this in the quality score keywordMatch and overall
        (qualityScore as any).keywordMatch = 100;
        const truth = (qualityScore as any).truthfulness || 0;
        const comp = (qualityScore as any).completeness || 0;
        (qualityScore as any).overall = Math.round(truth * 0.4 + comp * 0.3 + 100 * 0.3);
      } else {
        // Don't boost - keep the real score if keywords were lost
        if (!allMatchedPreserved) {
          logger.warn('Not boosting to 100% because some matched keywords were lost during regeneration');
        }
        if (!allMissingAdded) {
          logger.warn('Not boosting to 100% because some missing keywords were not added');
        }
      }

      // Generate documents
      const docGenStartTime = Date.now();
      // Get user's template preference
      const template = await this.getUserTemplate(user.id);
      
      let docxContent: Buffer;
      let pdfContent: Buffer | null = null;

      if (structuredData) {
        docxContent = await documentService.generateDocxFromStructured(structuredData, template);
        try {
          pdfContent = await documentService.generatePdfFromStructured(structuredData, template);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed (continuing with DOCX only):', {
            error: pdfError?.message || String(pdfError),
          });
          pdfContent = null;
        }
      } else {
        const resumeText = fullTailoredResume;
        docxContent = await documentService.generateDocxFromText(resumeText, template);
        try {
          pdfContent = await documentService.generatePdfFromText(resumeText, template);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed (continuing with DOCX only):', {
            error: pdfError?.message || String(pdfError),
          });
          pdfContent = null;
        }
      }

      // Upload DOCX to Cloudinary
      const timestamp = Date.now();
      const docxUrl = await fileUploadService.uploadFileContent(
        docxContent,
        'tailored-resumes',
        `tailored_${resumeId}_${timestamp}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      // Upload PDF to Cloudinary (if generated)
      let pdfUrl: string | null = null;
      if (pdfContent) {
        try {
          pdfUrl = await fileUploadService.uploadFileContent(
            pdfContent,
            'tailored-resumes',
            `tailored_${resumeId}_${timestamp}.pdf`,
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

      // Prepare update data
      const updateData = {
        downloadUrls: downloadUrls as any,
        tailoredDocxUrl: docxUrl,
        tailoredPdfUrl: pdfUrl || null,
        tailoredResumeText: fullTailoredResume,
        coverLetter,
        qualityScore: qualityScore as any,
        similarityMetrics: similarityMetrics as any,
      } as any;

      await prisma.resume.update({
        where: { id: resume.id },
        data: updateData,
      });

      const docGenTime = Date.now();
      const totalTime = Date.now();

      logger.info('Resume regeneration completed', {
        resume_id: resumeId,
        total_duration_ms: totalTime - startTime,
        total_duration_seconds: (totalTime - startTime) / 1000,
        breakdown: {
          openai_ms: openAiTime - startTime,
          doc_generation_ms: docGenTime - docGenStartTime,
          upload_ms: totalTime - docGenTime,
        },
        similarity_score: similarityMetrics.similarityScore,
        quality_score: qualityScore.overall,
      });

      ApiResponseFormatter.success(
        res,
        {
          fullResume: fullTailoredResume,
          fullDocument: fullTailoredResume, // Keep for backward compatibility
          coverLetter,
          downloadUrls,
          qualityScore,
          similarityMetrics,
        },
        'Resume regenerated successfully'
      );
    } catch (error: any) {
      logger.error('Resume regeneration error:', error);
      ApiResponseFormatter.error(res, 'Failed to regenerate resume: ' + error.message, 500);
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
      let coverLetterText = '';
      
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
        coverLetterText = content.coverLetter || '';
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
        coverLetterText = resume.coverLetter || '';
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
      // Get user's template preference
      const template = await this.getUserTemplate(user.id);
      
      let fileContent: Buffer;
      if (downloadFormat === 'docx') {
        fileContent = await documentService.generateDocxFromText(resumeText, template);
      } else {
        try {
          fileContent = await documentService.generatePdfFromText(resumeText, template);
        } catch (pdfError: any) {
          logger.warn('PDF generation failed, falling back to DOCX:', pdfError);
          fileContent = await documentService.generateDocxFromText(resumeText, template);
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

      // Always create a new version record for each download (snapshot)
      // Upload file to Cloudinary and save URLs
      let uploadedDocxUrl: string | null = null;
      let uploadedPdfUrl: string | null = null;
      const downloadUrls: { docx?: string; pdf?: string } = {};

      try {
        // Upload the generated file to Cloudinary
        const timestamp = Date.now();
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `tailored-resume-${dateStr}-${timestamp}`;
        
        if (downloadFormat === 'docx') {
          const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          const uploadedUrl = await fileUploadService.uploadFileContent(
            fileContent,
            'tailored-resumes',
            `${filename}.docx`,
            mimeType
          );
          uploadedDocxUrl = uploadedUrl;
          downloadUrls.docx = uploadedUrl;
          logger.info('DOCX file uploaded to Cloudinary', { url: uploadedDocxUrl, filename: `${filename}.docx` });
        } else {
          const mimeType = 'application/pdf';
          const uploadedUrl = await fileUploadService.uploadFileContent(
            fileContent,
            'tailored-resumes',
            `${filename}.pdf`,
            mimeType
          );
          uploadedPdfUrl = uploadedUrl;
          downloadUrls.pdf = uploadedUrl;
          logger.info('PDF file uploaded to Cloudinary', { url: uploadedPdfUrl, filename: `${filename}.pdf` });
        }

        // Create new version record with uploaded URLs
        const versionName = `Downloaded ${new Date().toLocaleDateString()} - ${downloadFormat.toUpperCase()}`;
        const newVersion = await prisma.resumeVersion.create({
          data: {
            resumeId: resume.id,
            versionName,
            tailoredResumeText: resumeText,
            coverLetter: coverLetterText || null,
            tailoredDocxUrl: uploadedDocxUrl,
            tailoredPdfUrl: uploadedPdfUrl,
            downloadUrls: downloadUrls,
            isCurrent: false, // Download versions are snapshots, not current editable versions
          },
        });

        logger.info('New version record created for download', {
          resumeId: resume.resumeId,
          versionId: newVersion.id,
          format: downloadFormat,
          versionName,
          hasDocxUrl: !!uploadedDocxUrl,
          hasPdfUrl: !!uploadedPdfUrl,
        });
      } catch (versionError: any) {
        logger.warn('Failed to create version record or upload file (continuing with download):', versionError);
        // Don't fail the download if version creation/upload fails
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
            tailoredDocxUrl: undefined,
            tailoredPdfUrl: undefined,
            downloadUrls: undefined,
          } as any,
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

  /**
   * Get all resume versions for a user with pagination
   */
  async getAllResumeVersions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Get all versions with their associated resume info
      const [versions, total] = await Promise.all([
        prisma.resumeVersion.findMany({
          where: {
            resume: {
              userId: req.user.id,
            },
          },
          include: {
            resume: {
              select: {
                resumeId: true,
                filename: true,
                displayName: true,
                isDefault: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: limit,
        }),
        prisma.resumeVersion.count({
          where: {
            resume: {
              userId: req.user.id,
            },
          },
        }),
      ]);

      const totalPages = Math.ceil(total / limit);

      ApiResponseFormatter.success(
        res,
        {
          versions: versions.map(version => {
            const downloadUrls = version.downloadUrls as any || {};
            return {
              id: version.id,
              versionId: version.id,
              resumeId: version.resume.resumeId,
              resumeName: version.resume.displayName || version.resume.filename,
              resumeFilename: version.resume.filename,
              isResumeDefault: version.resume.isDefault,
              versionName: version.versionName || `Version ${version.id}`,
              isCurrent: version.isCurrent,
              hasDocx: !!version.tailoredDocxUrl || !!downloadUrls.docx,
              hasPdf: !!version.tailoredPdfUrl || !!downloadUrls.pdf,
              downloadUrls: {
                docx: version.tailoredDocxUrl || downloadUrls.docx || null,
                pdf: version.tailoredPdfUrl || downloadUrls.pdf || null,
              },
              createdAt: version.createdAt.toISOString(),
              updatedAt: version.updatedAt.toISOString(),
            };
          }),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        },
        'Resume versions retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get all resume versions error:', error);
      ApiResponseFormatter.error(res, 'Failed to get resume versions: ' + error.message, 500);
    }
  }

  /**
   * Promote/Restore a resume version to main resume
   */
  async promoteVersionToMain(req: Request, res: Response): Promise<void> {
    try {
      const { versionId } = req.body;

      if (!versionId) {
        ApiResponseFormatter.error(res, 'Version ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify version belongs to user's resume
      const version = await prisma.resumeVersion.findFirst({
        where: {
          id: parseInt(versionId as string),
          resume: {
            userId: user.id,
          },
        },
        include: {
          resume: true,
        },
      });

      if (!version) {
        ApiResponseFormatter.error(res, 'Resume version not found', 404);
        return;
      }

      // Unset other current versions for this resume
      await prisma.resumeVersion.updateMany({
        where: { 
          resumeId: version.resumeId, 
          isCurrent: true,
          id: { not: version.id },
        },
        data: { isCurrent: false },
      });

      // Set this version as current
      await prisma.resumeVersion.update({
        where: { id: version.id },
        data: { isCurrent: true },
      });

      // Update the main resume with version's content
      const downloadUrls = version.downloadUrls as any || {};
      await prisma.resume.update({
        where: { id: version.resumeId },
        data: {
          tailoredResumeText: version.tailoredResumeText,
          coverLetter: version.coverLetter || null,
          tailoredDocxUrl: version.tailoredDocxUrl || downloadUrls.docx || null,
          tailoredPdfUrl: version.tailoredPdfUrl || downloadUrls.pdf || null,
          downloadUrls: version.downloadUrls || null,
        },
      });

      logger.info('Resume version promoted to main', {
        versionId: version.id,
        resumeId: version.resume.resumeId,
      });

      ApiResponseFormatter.success(
        res,
        { 
          versionId: version.id,
          resumeId: version.resume.resumeId,
        },
        'Resume version promoted to main successfully'
      );
    } catch (error: any) {
      logger.error('Promote version to main error:', error);
      ApiResponseFormatter.error(res, 'Failed to promote version: ' + error.message, 500);
    }
  }

  /**
   * Delete a resume version
   */
  async deleteResumeVersion(req: Request, res: Response): Promise<void> {
    try {
      const { versionId } = req.body;

      if (!versionId) {
        ApiResponseFormatter.error(res, 'Version ID is required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify version belongs to user's resume
      const version = await prisma.resumeVersion.findFirst({
        where: {
          id: parseInt(versionId as string),
          resume: {
            userId: user.id,
          },
        },
        include: {
          resume: true,
        },
      });

      if (!version) {
        ApiResponseFormatter.error(res, 'Resume version not found', 404);
        return;
      }

      // Delete files from Cloudinary if they exist
      try {
        if (version.tailoredDocxUrl) {
          const docxMatch = version.tailoredDocxUrl.match(/\/v\d+\/(.+)\.[^.]+$/);
          if (docxMatch) {
            await fileUploadService.deleteFile(docxMatch[1], 'raw');
          }
        }
        if (version.tailoredPdfUrl) {
          const pdfMatch = version.tailoredPdfUrl.match(/\/v\d+\/(.+)\.[^.]+$/);
          if (pdfMatch) {
            await fileUploadService.deleteFile(pdfMatch[1], 'raw');
          }
        }
        // Also check downloadUrls
        const downloadUrls = version.downloadUrls as any;
        if (downloadUrls) {
          if (downloadUrls.docx) {
            const docxMatch = downloadUrls.docx.match(/\/v\d+\/(.+)\.[^.]+$/);
            if (docxMatch) {
              await fileUploadService.deleteFile(docxMatch[1], 'raw');
            }
          }
          if (downloadUrls.pdf) {
            const pdfMatch = downloadUrls.pdf.match(/\/v\d+\/(.+)\.[^.]+$/);
            if (pdfMatch) {
              await fileUploadService.deleteFile(pdfMatch[1], 'raw');
            }
          }
        }
      } catch (cloudinaryError: any) {
        logger.warn('Failed to delete version files from Cloudinary:', cloudinaryError);
        // Continue with deletion even if Cloudinary deletion fails
      }

      // Delete the version from database
      await prisma.resumeVersion.delete({
        where: { id: version.id },
      });

      logger.info('Resume version deleted', {
        versionId: version.id,
        resumeId: version.resume.resumeId,
      });

      ApiResponseFormatter.success(
        res,
        { versionId: version.id },
        'Resume version deleted successfully'
      );
    } catch (error: any) {
      logger.error('Delete resume version error:', error);
      ApiResponseFormatter.error(res, 'Failed to delete resume version: ' + error.message, 500);
    }
  }

  /**
   * Get user's default template preference
   */
  async getDefaultTemplate(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { defaultTemplate: true },
      });

      const template = (user?.defaultTemplate as 'classic' | 'modern' | 'compact') || 'classic';

      ApiResponseFormatter.success(
        res,
        { template },
        'Default template retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get default template error:', error);
      ApiResponseFormatter.error(res, 'Failed to get default template: ' + error.message, 500);
    }
  }

  /**
   * Set user's default template preference
   */
  async setDefaultTemplate(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const { template } = req.body;

      if (!template || !['classic', 'modern', 'compact'].includes(template)) {
        ApiResponseFormatter.error(res, 'Invalid template. Must be classic, modern, or compact', 422);
        return;
      }

      await prisma.user.update({
        where: { id: req.user.id },
        data: { defaultTemplate: template },
      });

      logger.info('Default template updated', {
        userId: req.user.id,
        template,
      });

      ApiResponseFormatter.success(
        res,
        { template },
        'Default template updated successfully'
      );
    } catch (error: any) {
      logger.error('Set default template error:', error);
      ApiResponseFormatter.error(res, 'Failed to set default template: ' + error.message, 500);
    }
  }

  /**
   * Manually correct parsed resume content if parsing quality is low
   */
  async correctParsedContent(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId, correctedContent } = req.body;

      if (!resumeId || !correctedContent) {
        ApiResponseFormatter.error(res, 'Resume ID and corrected content are required', 422);
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

      // Validate corrected content structure
      if (!correctedContent.raw_text || correctedContent.raw_text.length < 100) {
        ApiResponseFormatter.error(res, 'Corrected content must include raw_text with at least 100 characters', 422);
        return;
      }

      // Re-validate the corrected content
      const quality = resumeParserService.validateParsingQuality(correctedContent);

      // Update resume with corrected content
      await prisma.resume.update({
        where: { id: resume.id },
        data: {
          parsedContent: correctedContent as any,
        },
      });

      logger.info('Resume parsed content manually corrected', {
        resumeId,
        qualityScore: quality.score,
        qualityConfidence: quality.confidence,
      });

      ApiResponseFormatter.success(
        res,
        {
          resumeId,
          parsingQuality: quality,
        },
        'Resume content corrected successfully'
      );
    } catch (error: any) {
      logger.error('Correct parsed content error:', error);
      ApiResponseFormatter.error(res, 'Failed to correct content: ' + error.message, 500);
    }
  }
}
