import pdfParse from 'pdf-parse';
import * as path from 'path';
import JSZip from 'jszip';
import logger from '../utils/logger';
import { ParsedResumeContent } from '../types';

export interface ParsingQuality {
  score: number; // 0-100
  confidence: 'high' | 'medium' | 'low';
  issues: string[];
  warnings: string[];
  isValid: boolean;
}

export class ResumeParserService {
  async parse(file: Express.Multer.File): Promise<ParsedResumeContent> {
    const extension = path.extname(file.originalname).toLowerCase();

    let parsed: ParsedResumeContent;
    if (extension === '.pdf') {
      parsed = await this.parsePDF(file);
    } else if (['.docx', '.doc'].includes(extension)) {
      parsed = await this.parseDOCX(file);
    } else {
      throw new Error('Unsupported file format. Please upload PDF or DOCX.');
    }

    // Validate parsing quality
    const quality = this.validateParsingQuality(parsed);
    logger.info('Resume parsing quality', {
      score: quality.score,
      confidence: quality.confidence,
      isValid: quality.isValid,
      issues: quality.issues.length,
      warnings: quality.warnings.length
    });

    // Attach quality metadata to parsed content
    (parsed as any).parsingQuality = quality;

    return parsed;
  }

  private async parsePDF(file: Express.Multer.File): Promise<ParsedResumeContent> {
    try {
      const data = await pdfParse(file.buffer);
      const text = this.cleanText(data.text);
      return this.extractStructureFromText(text);
    } catch (error: any) {
      logger.error('PDF parsing error:', error);
      throw new Error('Failed to parse PDF: ' + error.message);
    }
  }

  private async parseDOCX(file: Express.Multer.File): Promise<ParsedResumeContent> {
    try {
      const text = await this.extractTextFromDOCX(file.buffer);
      return this.extractStructureFromText(text);
    } catch (error: any) {
      logger.error('DOCX parsing error:', error);
      throw new Error('Failed to parse DOCX: ' + error.message);
    }
  }

  private async extractTextFromDOCX(buffer: Buffer): Promise<string> {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file('word/document.xml')?.async('string');

      if (!documentXml) {
        throw new Error('Could not extract document.xml from DOCX');
      }

      // Extract text from XML while preserving structure
      let text = documentXml
        .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1')
        .replace(/<[^>]+>/g, '\n')
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n');

      return this.cleanText(text);
    } catch (error: any) {
      logger.error('DOCX extraction error:', error);
      throw new Error('Failed to extract text from DOCX: ' + error.message);
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractStructureFromText(text: string): ParsedResumeContent {
    const lines = text.split('\n');
    const experience: Array<{
      title?: string;
      role?: string;
      company?: string;
      location?: string;
      period?: string;
      bullets?: string[];
    }> = [];
    const skills: string[] = [];
    const achievements: string[] = [];
    const education: Array<{
      degree?: string;
      school?: string;
      location?: string;
      year?: string;
    }> = [];
    let summary = '';
    let header: { name?: string; email?: string; phone?: string; location?: string; linkedin?: string; github?: string } = {};

    let currentSection = '';
    let currentExperience: any = null;
    let currentEducation: any = null;
    let inHeader = true;

    // Extract header information (first few lines)
    const headerLines = lines.slice(0, 5);
    for (const line of headerLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract email
      const emailMatch = trimmed.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (emailMatch) {
        header.email = emailMatch[0];
        inHeader = false;
        continue;
      }

      // Extract phone
      const phoneMatch = trimmed.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) {
        header.phone = phoneMatch[0];
        continue;
      }

      // Extract LinkedIn/GitHub
      if (trimmed.toLowerCase().includes('linkedin')) {
        const linkedinMatch = trimmed.match(/linkedin[:\s]*([^\s,]+)/i);
        if (linkedinMatch) header.linkedin = linkedinMatch[1];
      }
      if (trimmed.toLowerCase().includes('github')) {
        const githubMatch = trimmed.match(/github[:\s]*([^\s,]+)/i);
        if (githubMatch) header.github = githubMatch[1];
      }

      // First substantial line is likely the name
      if (!header.name && trimmed.length > 2 && trimmed.length < 50 && !emailMatch && !phoneMatch) {
        header.name = trimmed;
      }
    }

    // Extract location from header area
    const locationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))/;
    for (const line of headerLines) {
      const locationMatch = line.match(locationPattern);
      if (locationMatch && !line.includes('@') && !line.match(/\d{3}/)) {
        header.location = locationMatch[0].trim();
        break;
      }
    }

    // Process remaining lines
    for (let i = 5; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect sections with improved patterns
      const lowerLine = trimmed.toLowerCase();
      if (lowerLine.match(/^(summary|objective|profile|about)\s*:?$/i)) {
        currentSection = 'summary';
        continue;
      } else if (lowerLine.match(/^(experience|work\s+experience|employment|professional\s+experience)\s*:?$/i)) {
        currentSection = 'experience';
        continue;
      } else if (lowerLine.match(/^(skills?|technical\s+skills?|core\s+competencies)\s*:?$/i)) {
        currentSection = 'skills';
        continue;
      } else if (lowerLine.match(/^(achievements?|accomplishments?|awards?)\s*:?$/i)) {
        currentSection = 'achievements';
        continue;
      } else if (lowerLine.match(/^(education|academic|qualifications?)\s*:?$/i)) {
        currentSection = 'education';
        continue;
      }

      // Extract content based on section
      if (currentSection === 'summary' && trimmed.length > 20) {
        summary += trimmed + ' ';
      } else if (currentSection === 'experience') {
        // Improved experience extraction
        // Pattern: Job Title | Company | Location | Period
        const experiencePattern = /^(.+?)\s*[|\-–—]\s*(.+?)(?:\s*[|\-–—]\s*(.+?))?(?:\s*[|\-–—]\s*(.+?))?$/;
        const experienceMatch = trimmed.match(experiencePattern);
        
        if (experienceMatch && !/^[•\-\*]/.test(trimmed)) {
          // New experience entry
          if (currentExperience) {
            experience.push(currentExperience);
          }
          currentExperience = {
            role: experienceMatch[1]?.trim(),
            company: experienceMatch[2]?.trim(),
            location: experienceMatch[3]?.trim(),
            period: experienceMatch[4]?.trim(),
            bullets: []
          };
        } else if (/^[•\-\*]/.test(trimmed) || /^\d+\./.test(trimmed)) {
          // Bullet point
          if (currentExperience) {
            if (!currentExperience.bullets) {
              currentExperience.bullets = [];
            }
            currentExperience.bullets.push(trimmed.replace(/^[•\-\*\d\.\s]+/, ''));
          }
        } else if (trimmed.length > 10 && !currentExperience) {
          // Try to parse as job title if no current experience
          currentExperience = {
            role: trimmed,
            bullets: []
          };
        }
      } else if (currentSection === 'skills') {
        // Improved skills extraction
        if (/^[•\-\*]/.test(trimmed)) {
          const skill = trimmed.replace(/^[•\-\*\s]+/, '').trim();
          if (skill && skill.length > 1) {
            skills.push(skill);
          }
        } else if (trimmed.includes(',')) {
          const skillList = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 1);
          skills.push(...skillList);
        } else if (trimmed.includes('|')) {
          const skillList = trimmed.split('|').map(s => s.trim()).filter(s => s.length > 1);
          skills.push(...skillList);
        } else if (trimmed.length > 2 && trimmed.length < 50) {
          // Single skill on its own line
          skills.push(trimmed);
        }
      } else if (currentSection === 'achievements') {
        if (/^[•\-\*]/.test(trimmed) || /^\d+\./.test(trimmed)) {
          achievements.push(trimmed.replace(/^[•\-\*\d\.\s]+/, '').trim());
        }
      } else if (currentSection === 'education') {
        // Improved education extraction
        const educationPattern = /^(.+?)\s*[|\-–—]\s*(.+?)(?:\s*[|\-–—]\s*(.+?))?(?:\s*[|\-–—]\s*(.+?))?$/;
        const educationMatch = trimmed.match(educationPattern);
        
        if (educationMatch && !/^[•\-\*]/.test(trimmed)) {
          currentEducation = {
            degree: educationMatch[1]?.trim(),
            school: educationMatch[2]?.trim(),
            location: educationMatch[3]?.trim(),
            year: educationMatch[4]?.trim()
          };
          education.push(currentEducation);
          currentEducation = null;
        }
      }
    }

    // Add last experience if exists
    if (currentExperience) {
      experience.push(currentExperience);
    }

    return {
      summary: summary.trim() || undefined,
      experience: experience.length > 0 ? experience : undefined,
      skills: skills.length > 0 ? [...new Set(skills)] : undefined,
      achievements: achievements.length > 0 ? achievements : undefined,
      education: education.length > 0 ? education : undefined,
      raw_text: text,
      header: Object.keys(header).length > 0 ? header : undefined,
    } as ParsedResumeContent;
  }

  /**
   * Validate parsing quality and return quality metrics
   */
  validateParsingQuality(parsed: ParsedResumeContent): ParsingQuality {
    const issues: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    // Check if raw text exists and has reasonable length
    if (!parsed.raw_text || parsed.raw_text.length < 100) {
      issues.push('Resume text is too short or missing');
      score -= 30;
    }

    // Check summary
    if (!parsed.summary || parsed.summary.length < 50) {
      warnings.push('Summary is missing or too short');
      score -= 5;
    }

    // Check experience
    if (!parsed.experience || parsed.experience.length === 0) {
      issues.push('No work experience found');
      score -= 25;
    } else {
      // Validate experience entries
      parsed.experience.forEach((exp, idx) => {
        if (!exp.role && !exp.title) {
          warnings.push(`Experience entry ${idx + 1} is missing job title`);
          score -= 3;
        }
        if (!exp.company) {
          warnings.push(`Experience entry ${idx + 1} is missing company name`);
          score -= 2;
        }
        if (!exp.bullets || exp.bullets.length === 0) {
          warnings.push(`Experience entry ${idx + 1} has no bullet points`);
          score -= 2;
        }
      });
    }

    // Check skills
    if (!parsed.skills || parsed.skills.length === 0) {
      issues.push('No skills found');
      score -= 20;
    } else if (parsed.skills.length < 3) {
      warnings.push('Very few skills detected (less than 3)');
      score -= 5;
    }

    // Check if text seems corrupted or mostly empty
    if (parsed.raw_text) {
      const nonWhitespaceRatio = (parsed.raw_text.replace(/\s/g, '').length / parsed.raw_text.length);
      if (nonWhitespaceRatio < 0.3) {
        issues.push('Resume text appears to be mostly whitespace');
        score -= 15;
      }

      // Check for common parsing artifacts
      if (parsed.raw_text.includes('') || parsed.raw_text.match(/[^\x00-\x7F]{10,}/)) {
        warnings.push('Possible encoding issues detected');
        score -= 5;
      }
    }

    // Determine confidence level
    let confidence: 'high' | 'medium' | 'low';
    if (score >= 80 && issues.length === 0) {
      confidence = 'high';
    } else if (score >= 60 && issues.length <= 1) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const isValid = score >= 50 && issues.length < 2;

    return {
      score: Math.max(0, Math.min(100, score)),
      confidence,
      issues,
      warnings,
      isValid
    };
  }
}
