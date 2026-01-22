import logger from '../utils/logger';
import { ParsedResumeContent } from '../types';
import { SemanticATSService } from './semantic-ats.service';

export interface QualityScore {
  overall: number; // 0-100
  truthfulness: number; // 0-100 (how much is grounded in original resume)
  completeness: number; // 0-100 (how complete the tailored content is)
  keywordMatch: number; // 0-100 (ATS keyword coverage)
  warnings: string[]; // Array of warning messages
  flags: {
    hasHallucination: boolean;
    hasMissingKeywords: boolean;
    hasIncompleteSections: boolean;
  };
}

export interface SimilarityMetrics {
  similarityScore: number; // 0-100 percentage
  matchedKeywords: string[];
  missingKeywords: string[];
  keywordCoverage: number; // 0-100
  sectionMatches: {
    skills: number;
    experience: number;
    education: number;
  };
}

export class QualityService {
  private semanticATSService: SemanticATSService | null = null;

  constructor() {
    try {
      this.semanticATSService = new SemanticATSService();
    } catch (error) {
      logger.warn('Semantic ATS Service not available, using fallback', error);
      this.semanticATSService = null; // Will use fallback methods if service unavailable
    }
  }

  /**
   * Validate AI-generated content for hallucination and quality issues
   */
  validateContent(
    originalResume: ParsedResumeContent,
    tailoredContent: string,
    jobDescription: string,
    generateFreely: boolean
  ): QualityScore {
    const warnings: string[] = [];
    const flags = {
      hasHallucination: false,
      hasMissingKeywords: false,
      hasIncompleteSections: false,
    };

    // Use high-impact keywords only (ignore noise words)
    const jobKeywords = this.extractHighImpactKeywords(jobDescription);
    const tailoredKeywords = this.extractHighImpactKeywords(tailoredContent);

    // Check for potential hallucination (only in strict mode)
    if (!generateFreely) {
      const hallucinationCheck = this.checkHallucination(
        originalResume,
        tailoredContent
      );
      if (hallucinationCheck.hasIssues) {
        flags.hasHallucination = true;
        warnings.push(...hallucinationCheck.warnings);
      }
    }

    // Check keyword coverage - only high-impact keywords
    const missingKeywords = jobKeywords.filter(
      (keyword) => !tailoredKeywords.some(
        (tk) => tk.toLowerCase() === keyword.toLowerCase() || this.isSemanticMatch(tk, keyword)
      )
    );
    
    // Only show warnings for truly missing high-impact keywords (limit to top 10)
    if (missingKeywords.length > 0) {
      flags.hasMissingKeywords = true;
      const topMissing = missingKeywords.slice(0, 10);
      if (topMissing.length <= 5) {
        warnings.push(
          `Missing ${topMissing.length} high-impact keyword${topMissing.length > 1 ? 's' : ''}: ${topMissing.join(', ')}`
        );
      } else {
        warnings.push(
          `Missing ${topMissing.length} high-impact keywords (top ones: ${topMissing.slice(0, 3).join(', ')}, and ${topMissing.length - 3} more)`
        );
      }
    }

    // Check completeness
    const completenessCheck = this.checkCompleteness(
      originalResume,
      tailoredContent
    );
    if (completenessCheck.hasIssues) {
      flags.hasIncompleteSections = true;
      warnings.push(...completenessCheck.warnings);
    }

    // Calculate scores
    const truthfulness = this.calculateTruthfulness(
      originalResume,
      tailoredContent,
      generateFreely
    );
    const completeness = completenessCheck.score;
    const keywordMatch = this.calculateKeywordMatch(
      jobKeywords,
      tailoredKeywords
    );

    // Overall score (weighted average)
    const overall =
      truthfulness * 0.4 + completeness * 0.3 + keywordMatch * 0.3;

    return {
      overall: Math.round(overall),
      truthfulness: Math.round(truthfulness),
      completeness: Math.round(completeness),
      keywordMatch: Math.round(keywordMatch),
      warnings,
      flags,
    };
  }

  /**
   * Calculate similarity score between resume and job description using AI semantic analysis
   */
  async calculateSimilarity(
    resumeContent: string,
    jobDescription: string,
    generateFreely: boolean = false
  ): Promise<SimilarityMetrics> {
    // Use AI-powered semantic analysis if available
    if (this.semanticATSService !== null) {
      try {
        const semanticResult = await this.semanticATSService.analyzeATSMatch(
          resumeContent,
          jobDescription,
          generateFreely
        );

        return {
          similarityScore: semanticResult.similarityScore,
          matchedKeywords: semanticResult.highImpactKeywords.matched,
          missingKeywords: semanticResult.highImpactKeywords.missing,
          keywordCoverage: semanticResult.keywordCoverage,
          sectionMatches: {
            skills: semanticResult.semanticMatches.skills,
            experience: semanticResult.semanticMatches.experience,
            education: semanticResult.semanticMatches.education,
          },
        };
      } catch (error) {
        logger.error('Semantic ATS analysis failed, using fallback', error);
        // Fall through to fallback
      }
    }

    // Fallback to improved keyword extraction (still better than before)
    return this.calculateSimilarityFallback(resumeContent, jobDescription);
  }

  /**
   * Fallback similarity calculation with improved keyword extraction
   */
  private calculateSimilarityFallback(
    resumeContent: string,
    jobDescription: string
  ): SimilarityMetrics {
    // Use high-impact keyword extraction (ignores noise)
    const resumeKeywords = this.extractHighImpactKeywords(resumeContent);
    const jobKeywords = this.extractHighImpactKeywords(jobDescription);

    // Find matched and missing keywords (with semantic matching)
    const matchedKeywords = jobKeywords.filter((keyword) =>
      resumeKeywords.some((rk) => 
        rk.toLowerCase() === keyword.toLowerCase() || 
        this.isSemanticMatch(rk, keyword)
      )
    );
    const missingKeywords = jobKeywords.filter(
      (keyword) => !matchedKeywords.some((m) => m.toLowerCase() === keyword.toLowerCase())
    );

    // Calculate keyword coverage (only high-impact keywords)
    const keywordCoverage =
      jobKeywords.length > 0
        ? (matchedKeywords.length / jobKeywords.length) * 100
        : 0;

    // Calculate section-specific matches
    const sectionMatches = this.calculateSectionMatches(
      resumeContent,
      jobDescription
    );

    // Overall similarity score (weighted, with boost for semantic understanding)
    const similarityScore =
      keywordCoverage * 0.7 + // Higher weight on keyword coverage
      (sectionMatches.skills * 0.15 +
        sectionMatches.experience * 0.1 +
        sectionMatches.education * 0.05);

    return {
      similarityScore: Math.round(Math.min(100, similarityScore)),
      matchedKeywords: matchedKeywords.slice(0, 30), // Limit to top matches
      missingKeywords: missingKeywords.slice(0, 20), // Limit to top missing
      keywordCoverage: Math.round(keywordCoverage),
      sectionMatches,
    };
  }

  /**
   * Extract high-impact keywords (skills, tools, technologies) - ignore noise
   */
  private extractHighImpactKeywords(text: string): string[] {
    const noiseWords = new Set([
      // Job board boilerplate
      'posted', 'apply', 'save', 'share', 'days', 'ago', 'weeks', 'months',
      'mount', 'laurel', 'onsite', 'remote', 'hybrid', 'full-time', 'part-time',
      'glance', 'united', 'states', 'work', 'home',
      // Dates
      'january', 'february', 'march', 'april', 'may', 'june', 'july',
      'august', 'september', 'october', 'november', 'december',
      // Common filler
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
      'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
      'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
      'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
      'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now',
      // Job description filler
      'looking', 'seeking', 'candidate', 'position', 'role', 'opportunity',
      'company', 'team', 'environment', 'culture', 'benefits',
      'compensation', 'salary', 'hour', 'week', 'year', 'experience', 'required',
      'preferred', 'qualifications', 'responsibilities', 'duties', 'tasks',
    ]);

    const normalized = text.toLowerCase();
    const keywords = new Set<string>();

    // Extract technical terms (common patterns)
    const technicalPatterns = [
      /\b(python|java|javascript|typescript|react|vue|angular|node|django|flask|laravel|spring|express|next|nuxt)\b/gi,
      /\b(aws|azure|gcp|docker|kubernetes|terraform|jenkins|gitlab|github|ci\/cd)\b/gi,
      /\b(mysql|postgresql|mongodb|redis|elasticsearch|dynamodb)\b/gi,
      /\b(agile|scrum|kanban|devops|tdd|bdd)\b/gi,
      /\b(git|jira|confluence|slack|figma|sketch|tableau|power\s*bi)\b/gi,
    ];

    technicalPatterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((m) => {
          const clean = m.toLowerCase().trim();
          if (clean.length >= 3 && !noiseWords.has(clean)) {
            keywords.add(clean);
          }
        });
      }
    });

    // Extract capitalized words (likely technologies, tools, skills)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    capitalizedWords.forEach((word) => {
      const clean = word.toLowerCase().trim();
      if (clean.length >= 3 && !noiseWords.has(clean) && !/^\d+$/.test(clean)) {
        keywords.add(clean);
      }
    });

    return Array.from(keywords);
  }

  /**
   * Check if two keywords are semantically related
   */
  private isSemanticMatch(keyword1: string, keyword2: string): boolean {
    const k1 = keyword1.toLowerCase();
    const k2 = keyword2.toLowerCase();

    if (k1 === k2) return true;

    // Common semantic pairs
    const semanticPairs: [string, string][] = [
      ['hardware', 'electronic'], ['software', 'application'],
      ['cloud', 'aws'], ['cloud', 'azure'], ['cloud', 'gcp'],
      ['database', 'mysql'], ['database', 'postgresql'], ['database', 'mongodb'],
      ['team', 'leadership'], ['manage', 'lead'], ['develop', 'build'],
      ['create', 'build'], ['programming', 'coding'], ['programming', 'development'],
    ];

    return semanticPairs.some(
      ([a, b]) => (k1.includes(a) && k2.includes(b)) || (k1.includes(b) && k2.includes(a))
    );
  }

  /**
   * Extract keywords from text (simplified - can be enhanced with NLP)
   */
  private extractKeywords(text: string): string[] {
    if (!text) return [];

    // Convert to lowercase and remove special characters
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');

    // Common stop words to exclude
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'were',
      'been',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'should',
      'could',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'what',
      'which',
      'who',
      'whom',
      'whose',
      'where',
      'when',
      'why',
      'how',
      'all',
      'each',
      'every',
      'both',
      'few',
      'more',
      'most',
      'other',
      'some',
      'such',
      'no',
      'nor',
      'not',
      'only',
      'own',
      'same',
      'so',
      'than',
      'too',
      'very',
      's',
      't',
      'can',
      'will',
      'just',
      'don',
      'should',
      'now',
    ]);

    // Extract words (2+ characters, not stop words)
    const words = normalized
      .split(' ')
      .filter(
        (word) => word.length >= 2 && !stopWords.has(word) && !/^\d+$/.test(word)
      );

    // Count frequency and return unique keywords
    const keywordSet = new Set<string>();
    words.forEach((word) => {
      if (word.length >= 3) {
        // Only include words 3+ characters
        keywordSet.add(word);
      }
    });

    return Array.from(keywordSet);
  }

  /**
   * Check for potential hallucination in tailored content
   */
  private checkHallucination(
    originalResume: ParsedResumeContent,
    tailoredContent: string
  ): { hasIssues: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const originalText = (originalResume.raw_text || '').toLowerCase();
    const tailoredText = tailoredContent.toLowerCase();

    // Extract company names from original resume
    const originalCompanies = this.extractCompanies(originalResume);
    const tailoredCompanies = this.extractCompaniesFromText(tailoredContent);

    // Check for new companies not in original
    const newCompanies = tailoredCompanies.filter(
      (company) => !originalCompanies.some((oc) => oc.toLowerCase() === company.toLowerCase())
    );
    if (newCompanies.length > 0) {
      warnings.push(
        `Warning: New companies detected that weren't in original resume: ${newCompanies.join(', ')}`
      );
    }

    // Check for new job titles that are significantly different
    const originalTitles = this.extractJobTitles(originalResume);
    const tailoredTitles = this.extractJobTitlesFromText(tailoredContent);

    // This is a simplified check - in production, use more sophisticated matching
    const suspiciousTitles = tailoredTitles.filter(
      (title) =>
        !originalTitles.some((ot) =>
          title.toLowerCase().includes(ot.toLowerCase()) ||
          ot.toLowerCase().includes(title.toLowerCase())
        )
    );

    if (suspiciousTitles.length > 0 && suspiciousTitles.length > originalTitles.length) {
      warnings.push(
        `Warning: New job titles detected that may not match original experience`
      );
    }

    return {
      hasIssues: warnings.length > 0,
      warnings,
    };
  }

  /**
   * Check completeness of tailored content
   */
  private checkCompleteness(
    originalResume: ParsedResumeContent,
    tailoredContent: string
  ): { score: number; hasIssues: boolean; warnings: string[] } {
    const warnings: string[] = [];
    let score = 100;

    // Check for required sections
    const requiredSections = ['experience', 'skills', 'education'];
    const tailoredLower = tailoredContent.toLowerCase();

    requiredSections.forEach((section) => {
      if (!tailoredLower.includes(section)) {
        warnings.push(`Missing ${section} section`);
        score -= 20;
      }
    });

    // Check if content is too short (might be incomplete)
    if (tailoredContent.length < 500) {
      warnings.push('Tailored content seems too short');
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      hasIssues: warnings.length > 0,
      warnings,
    };
  }

  /**
   * Calculate truthfulness score
   */
  private calculateTruthfulness(
    originalResume: ParsedResumeContent,
    tailoredContent: string,
    generateFreely: boolean
  ): number {
    if (generateFreely) {
      // In flexible mode, we're more lenient
      return 85; // Assume 85% truthfulness in flexible mode
    }

    // In strict mode, check how much content matches original
    const originalText = (originalResume.raw_text || '').toLowerCase();
    const tailoredText = tailoredContent.toLowerCase();

    // Simple word overlap check
    const originalWords = new Set(
      originalText.split(/\s+/).filter((w) => w.length >= 4)
    );
    const tailoredWords = new Set(
      tailoredText.split(/\s+/).filter((w) => w.length >= 4)
    );

    const overlap = Array.from(tailoredWords).filter((w) =>
      originalWords.has(w)
    ).length;
    const totalTailored = tailoredWords.size;

    if (totalTailored === 0) return 0;

    const overlapRatio = overlap / totalTailored;
    return Math.min(100, Math.round(overlapRatio * 100));
  }

  /**
   * Calculate keyword match score
   */
  private calculateKeywordMatch(
    jobKeywords: string[],
    tailoredKeywords: string[]
  ): number {
    if (jobKeywords.length === 0) return 100;

    const matched = jobKeywords.filter((keyword) =>
      tailoredKeywords.includes(keyword)
    ).length;

    return Math.round((matched / jobKeywords.length) * 100);
  }

  /**
   * Calculate section-specific matches
   */
  private calculateSectionMatches(
    resumeContent: string,
    jobDescription: string
  ): { skills: number; experience: number; education: number } {
    const resumeLower = resumeContent.toLowerCase();
    const jobLower = jobDescription.toLowerCase();

    // Extract skills-related keywords
    const skillKeywords = this.extractSkillKeywords(jobLower);
    const resumeSkills = this.extractSkillKeywords(resumeLower);
    const skillsMatch =
      skillKeywords.length > 0
        ? (skillKeywords.filter((sk) => resumeSkills.includes(sk)).length /
            skillKeywords.length) *
          100
        : 100;

    // Experience match (simplified - check for experience-related terms)
    const experienceTerms = ['experience', 'worked', 'developed', 'managed', 'led'];
    const jobHasExperience = experienceTerms.some((term) =>
      jobLower.includes(term)
    );
    const resumeHasExperience = experienceTerms.some((term) =>
      resumeLower.includes(term)
    );
    const experienceMatch = jobHasExperience && resumeHasExperience ? 100 : 50;

    // Education match
    const educationTerms = ['degree', 'education', 'bachelor', 'master', 'phd'];
    const jobHasEducation = educationTerms.some((term) =>
      jobLower.includes(term)
    );
    const resumeHasEducation = educationTerms.some((term) =>
      resumeLower.includes(term)
    );
    const educationMatch = jobHasEducation && resumeHasEducation ? 100 : 50;

    return {
      skills: Math.round(skillsMatch),
      experience: experienceMatch,
      education: educationMatch,
    };
  }

  /**
   * Extract companies from resume content
   */
  private extractCompanies(resume: ParsedResumeContent): string[] {
    const companies: string[] = [];
    if (resume.experience) {
      resume.experience.forEach((exp: any) => {
        if (exp.company) companies.push(exp.company);
      });
    }
    return companies;
  }

  /**
   * Extract companies from text
   */
  private extractCompaniesFromText(text: string): string[] {
    // Simplified - look for patterns like "at Company Name" or "Company Name,"
    const companyPattern = /(?:at|with|from)\s+([A-Z][a-zA-Z\s&]+?)(?:,|\.|$)/g;
    const matches = text.match(companyPattern);
    return matches
      ? matches.map((m) => m.replace(/(?:at|with|from)\s+/i, '').trim())
      : [];
  }

  /**
   * Extract job titles from resume
   */
  private extractJobTitles(resume: ParsedResumeContent): string[] {
    const titles: string[] = [];
    if (resume.experience) {
      resume.experience.forEach((exp: any) => {
        if (exp.role || exp.title) titles.push(exp.role || exp.title);
      });
    }
    return titles;
  }

  /**
   * Extract job titles from text
   */
  private extractJobTitlesFromText(text: string): string[] {
    // Look for common job title patterns
    const titlePattern = /(?:as|position|role|title)[:\s]+([A-Z][a-zA-Z\s]+?)(?:,|\.|at|$)/gi;
    const matches = text.match(titlePattern);
    return matches
      ? matches.map((m) => m.replace(/(?:as|position|role|title)[:\s]+/i, '').trim())
      : [];
  }

  /**
   * Extract skill-related keywords
   */
  private extractSkillKeywords(text: string): string[] {
    const skillIndicators = [
      'skill',
      'proficient',
      'experience with',
      'knowledge of',
      'familiar with',
      'expertise in',
    ];
    const keywords: string[] = [];

    skillIndicators.forEach((indicator) => {
      const regex = new RegExp(
        `${indicator}[\\s:]+([^.,;]+)`,
        'gi'
      );
      const matches = text.match(regex);
      if (matches) {
        matches.forEach((match) => {
          const skills = match
            .replace(new RegExp(indicator, 'gi'), '')
            .split(/[,;]/)
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 2);
          keywords.push(...skills);
        });
      }
    });

    return [...new Set(keywords)];
  }
}
