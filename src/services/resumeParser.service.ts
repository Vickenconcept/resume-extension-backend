import pdfParse from 'pdf-parse';
import * as path from 'path';
import JSZip from 'jszip';
import logger from '../utils/logger';
import { ParsedResumeContent } from '../types';

export class ResumeParserService {
  async parse(file: Express.Multer.File): Promise<ParsedResumeContent> {
    const extension = path.extname(file.originalname).toLowerCase();

    if (extension === '.pdf') {
      return this.parsePDF(file);
    } else if (['.docx', '.doc'].includes(extension)) {
      return this.parseDOCX(file);
    }

    throw new Error('Unsupported file format. Please upload PDF or DOCX.');
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
      company?: string;
      location?: string;
      period?: string;
      bullets?: string[];
    }> = [];
    const skills: string[] = [];
    const achievements: string[] = [];
    let summary = '';

    let currentSection = '';
    let currentExperience: any = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect sections
      const lowerLine = trimmed.toLowerCase();
      if (lowerLine.includes('summary') || lowerLine.includes('objective')) {
        currentSection = 'summary';
      } else if (lowerLine.includes('experience') || lowerLine.includes('employment')) {
        currentSection = 'experience';
      } else if (lowerLine.includes('skills')) {
        currentSection = 'skills';
      } else if (lowerLine.includes('achievements') || lowerLine.includes('accomplishments')) {
        currentSection = 'achievements';
      }

      // Extract content based on section
      if (currentSection === 'summary' && trimmed.length > 20) {
        summary += trimmed + ' ';
      } else if (currentSection === 'experience') {
        // Simple bullet detection
        if (/^[•\-\*]/.test(trimmed) || /^\d+\./.test(trimmed)) {
          if (currentExperience) {
            if (!currentExperience.bullets) {
              currentExperience.bullets = [];
            }
            currentExperience.bullets.push(trimmed.replace(/^[•\-\*\d\.\s]+/, ''));
          }
        }
      } else if (currentSection === 'skills') {
        // Extract skills (comma-separated or bullet points)
        if (/^[•\-\*]/.test(trimmed)) {
          const skill = trimmed.replace(/^[•\-\*\s]+/, '');
          if (skill) {
            skills.push(skill);
          }
        } else if (trimmed.includes(',')) {
          const skillList = trimmed.split(',');
          for (const skill of skillList) {
            const trimmedSkill = skill.trim();
            if (trimmedSkill) {
              skills.push(trimmedSkill);
            }
          }
        }
      } else if (currentSection === 'achievements') {
        if (/^[•\-\*]/.test(trimmed) || /^\d+\./.test(trimmed)) {
          achievements.push(trimmed.replace(/^[•\-\*\d\.\s]+/, ''));
        }
      }
    }

    return {
      summary: summary.trim() || 'Professional summary not found',
      experience,
      skills: [...new Set(skills)],
      achievements,
      raw_text: text,
    };
  }
}
