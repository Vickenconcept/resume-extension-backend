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
      (keyword) =>
        !tailoredKeywords.some(
          (tk) =>
            tk.toLowerCase() === keyword.toLowerCase() ||
            this.isSemanticMatch(tk, keyword)
        )
    );

    // Calculate a preliminary keyword match score based on high-impact keywords
    const keywordMatch = this.calculateKeywordMatch(jobKeywords, tailoredKeywords);

    // Filter out company names, people names, and generic words from missing keywords
    const criticalMissing = missingKeywords.filter((kw) => {
      const lower = kw.toLowerCase().trim();

      // Filter out very short keywords (likely noise)
      if (lower.length < 3) return false;

      // Filter out known company / organization words and school names
      if (
        lower.includes('inc') ||
        lower.includes('llc') ||
        lower.includes('corp') ||
        lower.includes('company') ||
        lower.includes('health inc') ||
        lower.includes('healthcare inc') ||
        lower.includes('school') ||
        lower.includes('university') ||
        lower.includes('college') ||
        lower.includes('harvard') ||
        lower.includes('mit') ||
        lower.includes('stanford')
      ) {
        return false;
      }

      // Filter out generic words and common prepositions
      const genericWords = [
        'healthcare',
        'health',
        'care',
        'business',
        'industry',
        'slack',
        'email',
        'from',
        'to',
        'the',
        'a',
        'an',
        'and',
        'or',
        'but',
        'in',
        'on',
        'at',
        'for',
        'of',
        'with',
        'by',
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
        'open',
        'close',
        'new',
        'old',
        'first',
        'last',
        'next',
        'previous',
        'founder'
      ];
      if (genericWords.includes(lower)) return false;

      // Filter out months and dates
      const months = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december'
      ];
      if (
        months.some((month) => lower.includes(month)) ||
        lower.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)
      ) {
        return false;
      }

      // Filter out phrases starting with prepositions (e.g., "from january", "to open")
      if (lower.match(/^(from|to|at|in|on|with|by|for|of)\s+/)) return false;

      // Filter out common first names (likely from job descriptions mentioning people)
      const commonNames = [
        'jakob',
        'john',
        'jane',
        'mike',
        'sarah',
        'david',
        'emily',
        'chris',
        'lisa',
        'michael',
        'omi'
      ];
      if (commonNames.includes(lower)) return false;

      // Filter out job board boilerplate phrases (intern posted, save share apply, etc.)
      if (
        lower.match(
          /\b(intern\s+posted|save\s+share|apply\s+save|save\s+apply|apply\s+at|posted\s+\d+|days\s+ago)\b/
        )
      ) {
        return false;
      }

      // Filter out location phrases (united states work, etc.)
      if (
        lower.match(
          /\b(united\s+states\s+work|united\s+states|mount\s+laurel)\b/
        )
      ) {
        return false;
      }

      // Filter out phrases that are just boilerplate words combined
      if (
        lower.match(
          /^(intern|posted|save|share|apply|work|home|united|states)(\s+(intern|posted|save|share|apply|work|home|united|states))+$/
        )
      ) {
        return false;
      }

      // Filter out phrases containing common filler words (the, this, what, you, role, etc.)
      const fillerWords = ['the', 'this', 'that', 'what', 'which', 'who', 'you', 'your', 'role', 'app', 'application', 'job', 'position'];
      const words = lower.split(/\s+/);
      const fillerCount = words.filter(w => fillerWords.includes(w)).length;
      // If more than half the words are fillers, it's not a meaningful keyword
      if (fillerCount > 0 && fillerCount / words.length > 0.5) {
        return false;
      }
      
      // Filter out phrases that start or end with filler words (e.g., "the role this", "what you")
      if (fillerWords.includes(words[0]) || fillerWords.includes(words[words.length - 1])) {
        // Allow if it's a technical term (e.g., "the cloud", "the api" - but these should be filtered by other rules)
        // But reject if it's clearly a filler phrase
        if (words.length <= 3 && fillerCount >= 2) {
          return false;
        }
      }

      // Filter out single common words that aren't technical
      if (words.length === 1) {
        const singleWord = words[0];
        const nonTechnicalCommonWords = [
          'app', 'application', 'role', 'job', 'position', 'work', 'team', 'company',
          'this', 'that', 'what', 'which', 'who', 'you', 'your', 'the', 'a', 'an',
          'open', 'close', 'new', 'old', 'first', 'last', 'next', 'previous'
        ];
        if (nonTechnicalCommonWords.includes(singleWord)) {
          return false;
        }
      }

      // Filter out phrases that are just common words (e.g., "the role this", "what you need")
      const commonWordPhrases = [
        'the role', 'this role', 'the role this', 'what you', 'what you need',
        'the app', 'this app', 'the application', 'this application',
        'the job', 'this job', 'the position', 'this position',
        'you will', 'you must', 'you should', 'you need', 'you have',
        'we are', 'we have', 'we need', 'we want', 'we offer',
        'the team', 'this team', 'our team', 'the company', 'this company',
        'the work', 'this work', 'the project', 'this project'
      ];
      if (commonWordPhrases.some(phrase => lower.includes(phrase) && lower.split(/\s+/).length <= 4)) {
        return false;
      }

      // Only keep technical terms, skills, tools, technologies, or meaningful multi-word technical phrases
      // A keyword should either be:
      // 1. A single technical term (python, react, aws, etc.)
      // 2. A multi-word technical phrase (machine learning, cloud computing, etc.)
      // 3. A meaningful skill or methodology (agile development, test-driven development, etc.)
      return true;
    });

    // Only show warnings for truly critical missing keywords when the match score is low
    // and we are in strict mode. If keywordMatch is already high (95%+), don't show warnings
    // as the match is excellent. Also, if there are very few critical missing keywords (1-2),
    // they're likely noise, so ignore them.
    // Only show if: strict mode AND match < 80% AND more than 2 critical missing
    if (!generateFreely && keywordMatch < 80 && criticalMissing.length > 2) {
      flags.hasMissingKeywords = true;
      const topMissing = criticalMissing.slice(0, 5);
      if (topMissing.length <= 3) {
        warnings.push(
          `Missing ${topMissing.length} critical keyword${topMissing.length > 1 ? 's' : ''}: ${topMissing.join(', ')}`
        );
      } else {
        warnings.push(
          `Missing ${topMissing.length} critical keywords: ${topMissing
            .slice(0, 3)
            .join(', ')}, and ${topMissing.length - 3} more`
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
      const words = clean.split(/\s+/);
      
      // Skip if it's a noise word
      if (noiseWords.has(clean)) return;
      // Skip if it's a number
      if (/^\d+$/.test(clean)) return;
      // Skip if it's too short
      if (clean.length < 3) return;
      
      // Skip phrases that start with common filler words (The, This, What, You, etc.)
      const fillerStarters = ['the', 'this', 'that', 'what', 'which', 'who', 'you', 'your', 'our', 'we', 'they'];
      if (words.length > 1 && fillerStarters.includes(words[0])) {
        // Only allow if it's a known technical phrase (e.g., "The Cloud" -> "cloud" would be caught by patterns)
        // But reject generic phrases like "The Role", "This Position", "What You"
        const genericPhrases = ['role', 'position', 'job', 'work', 'team', 'company', 'app', 'application'];
        if (genericPhrases.includes(words[1]) || words.length <= 3) {
          return;
        }
      }
      
      // Skip single common words that aren't technical
      if (words.length === 1) {
        const nonTechnicalWords = ['app', 'application', 'role', 'job', 'position', 'work', 'team', 'company', 'this', 'that', 'what', 'you', 'your'];
        if (nonTechnicalWords.includes(clean)) {
          return;
        }
      }
      
      // Skip company names (contain "inc", "llc", "corp", "company", or are common company patterns)
      if (clean.includes('inc') || clean.includes('llc') || clean.includes('corp') || 
          clean.includes('company') || clean.includes('health inc') || clean.includes('healthcare inc') ||
          clean.match(/^[a-z]+\s+(inc|llc|corp|company)$/)) {
        return;
      }
      // Skip generic industry words (unless they're part of a technical term)
      if (['healthcare', 'health', 'care', 'business', 'industry', 'sector', 'field'].includes(clean) &&
          !clean.includes('tech') && !clean.includes('software')) {
        return;
      }
      
      // Skip phrases that are clearly not technical (e.g., "The Role This", "What You Need")
      if (words.length >= 2) {
        const fillerWords = ['the', 'this', 'that', 'what', 'which', 'who', 'you', 'your', 'role', 'app', 'job', 'position'];
        const fillerCount = words.filter(w => fillerWords.includes(w)).length;
        // If more than half are fillers, skip it
        if (fillerCount > 0 && fillerCount / words.length > 0.5) {
          return;
        }
        // If it's a short phrase (2-3 words) and contains multiple fillers, skip it
        if (words.length <= 3 && fillerCount >= 2) {
          return;
        }
      }
      
      keywords.add(clean);
    });

    // Filter out multi-word company names, generic phrases, and noise
    const filteredKeywords = Array.from(keywords).filter((kw) => {
      const lower = kw.toLowerCase();
      const words = lower.split(/\s+/);
      
      // Skip if it looks like a company name
      if (lower.includes(' health') || lower.includes(' healthcare') || lower.match(/^[a-z]+\s+health/)) {
        return false;
      }
      
      // Skip generic words that slipped through (unless they're technical)
      if (['slack', 'email', 'phone', 'zoom', 'teams'].includes(lower) && !lower.includes('api') && !lower.includes('sdk')) {
        return false;
      }
      
      // Skip single-word common non-technical terms
      if (words.length === 1) {
        const nonTechnicalSingleWords = ['app', 'application', 'role', 'job', 'position', 'work', 'team', 'company', 
                                        'this', 'that', 'what', 'you', 'your', 'the', 'a', 'an', 'open', 'close'];
        if (nonTechnicalSingleWords.includes(lower)) {
          return false;
        }
      }
      
      // Skip phrases that are clearly filler/non-technical
      const fillerWords = ['the', 'this', 'that', 'what', 'which', 'who', 'you', 'your', 'role', 'app', 'job', 'position', 'application'];
      const fillerCount = words.filter(w => fillerWords.includes(w)).length;
      
      // Reject phrases where most words are fillers
      if (words.length > 1 && fillerCount > 0 && fillerCount / words.length > 0.5) {
        return false;
      }
      
      // Reject short phrases (2-4 words) with multiple fillers
      if (words.length >= 2 && words.length <= 4 && fillerCount >= 2) {
        return false;
      }
      
      // Reject phrases starting/ending with fillers (e.g., "the role this", "what you")
      if (words.length >= 2 && (fillerWords.includes(words[0]) || fillerWords.includes(words[words.length - 1]))) {
        // Only allow if it's a known technical phrase, otherwise reject
        const knownTechnicalPhrases = ['machine learning', 'deep learning', 'natural language', 'artificial intelligence',
                                      'cloud computing', 'data science', 'web development', 'mobile development',
                                      'software engineering', 'system design', 'api design', 'user experience'];
        const isKnownTechnical = knownTechnicalPhrases.some(phrase => lower.includes(phrase));
        if (!isKnownTechnical && fillerCount >= 2) {
          return false;
        }
      }
      
      // Skip phrases containing job board boilerplate words
      const boilerplateWords = ['posted', 'apply', 'save', 'share', 'intern', 'internship', 'work', 'home', 'united', 'states'];
      if (boilerplateWords.some(word => lower.includes(word))) {
        // Only skip if it's clearly a boilerplate phrase, not a technical term
        if (lower.match(/\b(posted|apply|save|share|intern|internship|work|home|united|states)\b/) && 
            !lower.match(/\b(python|java|react|aws|docker|kubernetes|terraform|api|sdk|framework|library)\b/)) {
          return false;
        }
      }
      
      // Skip location phrases
      if (lower.match(/\b(united\s+states|mount\s+laurel|remote|onsite|hybrid)\b/)) {
        return false;
      }
      
      // Skip job board action phrases
      if (lower.match(/\b(save\s+share|apply\s+save|apply\s+at|posted\s+\d+|days\s+ago)\b/)) {
        return false;
      }
      
      // Skip if it's just generic words combined
      if (lower.match(/^(intern|posted|save|share|apply|work|home|united|states)(\s+(intern|posted|save|share|apply|work|home|united|states))*$/)) {
        return false;
      }
      
      return true;
    });

    return filteredKeywords;
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
    // Only check in strict mode, and be more lenient with rephrasing
    const originalTitles = this.extractJobTitles(originalResume);
    const tailoredTitles = this.extractJobTitlesFromText(tailoredContent);

    // More sophisticated matching - allow semantic variations
    const suspiciousTitles = tailoredTitles.filter((title) => {
      const titleLower = title.toLowerCase();
      
      // Check if it matches any original title (exact, substring, or semantic)
      const hasMatch = originalTitles.some((ot) => {
        const otLower = ot.toLowerCase();
        // Exact or substring match
        if (titleLower.includes(otLower) || otLower.includes(titleLower)) {
          return true;
        }
        // Semantic match - check for common title variations
        const titleWords = new Set(titleLower.split(/\s+/));
        const otWords = new Set(otLower.split(/\s+/));
        const commonWords = Array.from(titleWords).filter(w => otWords.has(w));
        // If they share significant words (at least 2), consider it a match
        return commonWords.length >= 2 && commonWords.some(w => w.length > 3);
      });
      
      return !hasMatch;
    });

    // Only warn if there are significantly more titles or completely new unrelated titles
    if (suspiciousTitles.length > 0 && 
        (suspiciousTitles.length > originalTitles.length * 1.5 || 
         suspiciousTitles.length >= 3)) {
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
   * Calculate keyword match score using semantic matching
   */
  private calculateKeywordMatch(
    jobKeywords: string[],
    tailoredKeywords: string[]
  ): number {
    if (jobKeywords.length === 0) return 100;

    // Use semantic matching (same as similarity calculation)
    const matched = jobKeywords.filter((keyword) =>
      tailoredKeywords.some(
        (tk) => tk.toLowerCase() === keyword.toLowerCase() || this.isSemanticMatch(tk, keyword)
      )
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
   * Extract companies from text (excluding tools/technologies)
   */
  private extractCompaniesFromText(text: string): string[] {
    // Known tools/technologies that should NOT be flagged as companies
    const toolsAndTechnologies = new Set([
      'github actions', 'github', 'docker', 'kubernetes', 'terraform', 'jenkins',
      'aws', 'azure', 'gcp', 'react', 'vue', 'angular', 'node', 'python', 'java',
      'javascript', 'typescript', 'django', 'flask', 'laravel', 'spring', 'express',
      'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb',
      'git', 'jira', 'confluence', 'slack', 'figma', 'sketch', 'tableau', 'power bi',
      'ci/cd', 'devops', 'agile', 'scrum', 'kanban', 'tdd', 'bdd'
    ]);
    
    // Simplified - look for patterns like "at Company Name" or "Company Name,"
    const companyPattern = /(?:at|with|from)\s+([A-Z][a-zA-Z\s&]+?)(?:,|\.|$)/g;
    const matches = text.match(companyPattern);
    if (!matches) return [];
    
    // Filter out tools/technologies and return only real company names
    return matches
      .map((m) => m.replace(/(?:at|with|from)\s+/i, '').trim())
      .filter((company) => {
        const lower = company.toLowerCase();
        // Exclude if it's a known tool/technology
        if (toolsAndTechnologies.has(lower)) {
          return false;
        }
        // Exclude if it contains common tool/tech keywords
        if (lower.includes('actions') || lower.includes('docker') || 
            lower.includes('kubernetes') || lower.includes('github')) {
          return false;
        }
        // Only keep if it looks like a real company name (has multiple words or common company suffixes)
        return company.split(/\s+/).length > 1 || 
               lower.includes('inc') || lower.includes('llc') || 
               lower.includes('corp') || lower.includes('ltd');
      });
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
