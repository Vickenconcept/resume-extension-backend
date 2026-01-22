import logger from '../utils/logger';
import OpenAI from 'openai';
import { ParsedResumeContent } from '../types';

export interface SemanticATSResult {
  similarityScore: number; // 0-100
  matchedKeywords: string[]; // High-impact keywords found
  missingKeywords: string[]; // Critical missing keywords only
  keywordCoverage: number; // 0-100
  semanticMatches: {
    skills: number; // 0-100
    experience: number; // 0-100
    education: number; // 0-100
    tools: number; // 0-100
  };
  recommendations: string[]; // Actionable recommendations
  highImpactKeywords: {
    matched: string[];
    missing: string[];
  };
}

export class SemanticATSService {
  private client: OpenAI;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }

  /**
   * Use AI to intelligently analyze ATS match with semantic understanding
   */
  async analyzeATSMatch(
    resumeContent: string,
    jobDescription: string,
    generateFreely: boolean = false
  ): Promise<SemanticATSResult> {
    try {
      const prompt = this.buildSemanticAnalysisPrompt(resumeContent, jobDescription, generateFreely);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert ATS (Applicant Tracking System) analyst. You understand how modern ATS systems work in 2026 - they use semantic matching, understand synonyms, and focus on high-impact keywords (skills, tools, technologies) rather than counting every word. You provide intelligent, realistic ATS match scores.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent analysis
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const analysis = JSON.parse(content);

      // Validate and normalize the response with minimum score enforcement
      const result = this.normalizeATSResult(analysis);
      
      // Enforce minimum scores: 95% for flexible, 70% for strict
      const minScore = generateFreely ? 95 : 70;
      if (result.similarityScore < minScore) {
        result.similarityScore = minScore;
        // Boost keyword coverage if needed
        if (result.keywordCoverage < minScore - 10) {
          result.keywordCoverage = Math.min(100, minScore - 5);
        }
      }
      
      return result;
    } catch (error: any) {
      logger.error('Semantic ATS Analysis Error:', error);
      // Fallback to basic analysis if AI fails
      return this.fallbackAnalysis(resumeContent, jobDescription);
    }
  }

  /**
   * Build prompt for semantic ATS analysis
   */
  private buildSemanticAnalysisPrompt(
    resumeContent: string,
    jobDescription: string,
    generateFreely: boolean = false
  ): string {
    return `Analyze how well this resume matches the job description using modern ATS (Applicant Tracking System) principles. Modern ATS systems in 2026 use semantic understanding, not just keyword counting.

RESUME CONTENT:
${resumeContent.substring(0, 4000)}${resumeContent.length > 4000 ? '...' : ''}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}${jobDescription.length > 4000 ? '...' : ''}

Your task:
1. Extract HIGH-IMPACT keywords from the job description:
   - Skills (e.g., "Python", "React", "AWS", "Docker")
   - Tools & Technologies (e.g., "GitHub", "Kubernetes", "PostgreSQL")
   - Certifications (e.g., "AWS Certified", "PMP")
   - Methodologies (e.g., "Agile", "Scrum", "CI/CD")
   - IGNORE: filler words, dates, locations, job board boilerplate ("posted", "apply", "weeks ago", "mount laurel", etc.)

2. Check for SEMANTIC matches (synonyms and related concepts):
   - "hardware engineering" matches "electronic design" or "circuit development"
   - "cloud computing" matches "AWS" or "Azure" or "GCP"
   - "team leadership" matches "managed team" or "led team"
   - "software development" matches "programming" or "coding"

3. Calculate realistic scores:
   - Similarity Score (0-100): Overall semantic match considering synonyms and context
   - Keyword Coverage (0-100): Percentage of high-impact keywords found (not all words)
   - Section Matches: How well skills, experience, education, and tools match

4. Provide recommendations:
   - Only suggest adding truly missing high-impact keywords
   - Suggest semantic alternatives if exact keywords aren't present
   - Focus on actionable improvements

Return a JSON object with this exact structure:
{
  "similarityScore": 85,
  "matchedKeywords": ["python", "react", "aws", "docker", "agile"],
  "missingKeywords": ["kubernetes", "terraform"],
  "keywordCoverage": 83,
  "semanticMatches": {
    "skills": 90,
    "experience": 85,
    "education": 80,
    "tools": 75
  },
  "recommendations": [
    "Add 'Kubernetes' to skills section - mentioned in job requirements",
    "Consider adding 'Terraform' if you have infrastructure experience"
  ],
  "highImpactKeywords": {
    "matched": ["python", "react", "aws", "docker"],
    "missing": ["kubernetes", "terraform"]
  }
}

IMPORTANT:
- Only include truly relevant, high-impact keywords in matchedKeywords and missingKeywords
- Ignore filler words, dates, locations, and job board boilerplate
- Use semantic understanding - if resume has "electronic design" and job wants "hardware engineering", count it as a match
- Be realistic - aim for 90%+ match on high-impact keywords, not every word
- Focus on skills, tools, technologies, and methodologies that actually matter for ATS`;
  }

  /**
   * Normalize and validate AI response
   */
  private normalizeATSResult(analysis: any): SemanticATSResult {
    return {
      similarityScore: Math.min(100, Math.max(0, analysis.similarityScore || 0)),
      matchedKeywords: Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : [],
      missingKeywords: Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [],
      keywordCoverage: Math.min(100, Math.max(0, analysis.keywordCoverage || 0)),
      semanticMatches: {
        skills: Math.min(100, Math.max(0, analysis.semanticMatches?.skills || 0)),
        experience: Math.min(100, Math.max(0, analysis.semanticMatches?.experience || 0)),
        education: Math.min(100, Math.max(0, analysis.semanticMatches?.education || 0)),
        tools: Math.min(100, Math.max(0, analysis.semanticMatches?.tools || 0)),
      },
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
      highImpactKeywords: {
        matched: Array.isArray(analysis.highImpactKeywords?.matched)
          ? analysis.highImpactKeywords.matched
          : [],
        missing: Array.isArray(analysis.highImpactKeywords?.missing)
          ? analysis.highImpactKeywords.missing
          : [],
      },
    };
  }

  /**
   * Fallback analysis if AI fails (simplified but still better than keyword counting)
   */
  private fallbackAnalysis(resumeContent: string, jobDescription: string): SemanticATSResult {
    // Extract high-impact keywords (skills, tools, technologies)
    const highImpactKeywords = this.extractHighImpactKeywords(jobDescription);
    const resumeKeywords = this.extractHighImpactKeywords(resumeContent);

    const matched = highImpactKeywords.filter((kw) =>
      resumeKeywords.some((rk) => rk.toLowerCase() === kw.toLowerCase() || 
        this.isSemanticMatch(rk, kw))
    );
    const missing = highImpactKeywords.filter(
      (kw) => !matched.some((m) => m.toLowerCase() === kw.toLowerCase())
    );

    const keywordCoverage = highImpactKeywords.length > 0
      ? (matched.length / highImpactKeywords.length) * 100
      : 0;

    // Calculate similarity with semantic understanding
    // Boost score more aggressively based on mode
    const semanticBoost = generateFreely ? 1.2 : 1.15; // More boost for flexible mode
    const baseScore = keywordCoverage * semanticBoost;
    
    // Ensure minimum scores: 95% for flexible, 70% for strict
    const minScore = generateFreely ? 95 : 70;
    const similarityScore = Math.min(100, Math.max(minScore, baseScore));
    
    // Boost section matches too
    const sectionBoost = generateFreely ? 1.1 : 1.05;

    return {
      similarityScore: Math.round(similarityScore),
      matchedKeywords: matched,
      missingKeywords: missing.slice(0, 10), // Limit to top 10 missing
      keywordCoverage: Math.round(keywordCoverage),
      semanticMatches: {
        skills: Math.round(Math.min(100, (keywordCoverage * 0.9) * sectionBoost)),
        experience: Math.round(Math.min(100, (keywordCoverage * 0.95) * sectionBoost)),
        education: Math.round(Math.min(100, 80 * sectionBoost)),
        tools: Math.round(Math.min(100, (keywordCoverage * 0.85) * sectionBoost)),
      },
      recommendations: missing.slice(0, 5).map(
        (kw) => `Consider adding "${kw}" if relevant to your experience`
      ),
      highImpactKeywords: {
        matched,
        missing: missing.slice(0, 10),
      },
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
      'posted', 'apply', 'save', 'share', 'glance', 'united', 'states',
      // Dates and time
      'january', 'february', 'march', 'april', 'may', 'june', 'july',
      'august', 'september', 'october', 'november', 'december',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
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
      'company', 'team', 'work', 'environment', 'culture', 'benefits',
      'compensation', 'salary', 'hour', 'week', 'year', 'experience', 'required',
      'preferred', 'qualifications', 'responsibilities', 'duties', 'tasks',
    ]);

    const normalized = text.toLowerCase();
    
    // Extract potential high-impact keywords (capitalized words, technical terms)
    const technicalPatterns = [
      // Programming languages and frameworks
      /\b(python|java|javascript|typescript|react|vue|angular|node|django|flask|laravel|spring|express)\b/gi,
      // Cloud and DevOps
      /\b(aws|azure|gcp|docker|kubernetes|terraform|jenkins|gitlab|github|ci\/cd)\b/gi,
      // Databases
      /\b(mysql|postgresql|mongodb|redis|elasticsearch|dynamodb)\b/gi,
      // Methodologies
      /\b(agile|scrum|kanban|devops|ci\/cd|tdd|bdd)\b/gi,
      // Tools
      /\b(git|jira|confluence|slack|figma|sketch|tableau|power\s*bi)\b/gi,
    ];

    const keywords = new Set<string>();
    
    // Extract from technical patterns
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

    // Extract capitalized words (likely proper nouns, technologies, tools)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    capitalizedWords.forEach((word) => {
      const clean = word.toLowerCase().trim();
      if (clean.length >= 3 && !noiseWords.has(clean) && !/^\d+$/.test(clean)) {
        keywords.add(clean);
      }
    });

    return Array.from(keywords).slice(0, 50); // Limit to top 50
  }

  /**
   * Check if two keywords are semantically related
   */
  private isSemanticMatch(keyword1: string, keyword2: string): boolean {
    const k1 = keyword1.toLowerCase();
    const k2 = keyword2.toLowerCase();

    // Exact match
    if (k1 === k2) return true;

    // Common semantic pairs
    const semanticPairs: [string, string][] = [
      ['hardware', 'electronic'],
      ['software', 'application'],
      ['cloud', 'aws'],
      ['cloud', 'azure'],
      ['cloud', 'gcp'],
      ['database', 'mysql'],
      ['database', 'postgresql'],
      ['database', 'mongodb'],
      ['team', 'leadership'],
      ['manage', 'lead'],
      ['develop', 'build'],
      ['create', 'build'],
      ['programming', 'coding'],
      ['programming', 'development'],
    ];

    return semanticPairs.some(
      ([a, b]) => (k1.includes(a) && k2.includes(b)) || (k1.includes(b) && k2.includes(a))
    );
  }
}
