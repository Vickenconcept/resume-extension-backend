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
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert ATS (Applicant Tracking System) analyst. You understand how modern ATS systems work in 2026 - they use semantic matching, understand synonyms, and focus on high-impact keywords (skills, tools, technologies) rather than counting every word. You provide intelligent, realistic ATS match scores. CRITICAL: If the same resume and job description are provided again, you MUST return the same keyword sets and scores. Be honest and accurate - scores should reflect the actual match quality, not inflated numbers. DOMAIN-AGNOSTIC: This works for ALL job types - ignore dates, locations, company names, and posting metadata. Only focus on actual skills, tools, technologies, and qualifications.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        // Use temperature 0 for maximum determinism so the same resume + job
        // description always produce the same keyword sets.
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const analysis = JSON.parse(content);

      // Validate and normalize the response - return REAL scores, no artificial inflation
      const result = this.normalizeATSResult(analysis, resumeContent);
      
      return result;
    } catch (error: any) {
      logger.error('Semantic ATS Analysis Error:', error);
      // Fallback to basic analysis if AI fails
      return this.fallbackAnalysis(resumeContent, jobDescription, generateFreely);
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

⚠️ DOMAIN-AGNOSTIC: This app works for ALL job types (software, healthcare, finance, marketing, etc.). Ignore dates, locations, company names, application instructions, or posting metadata. Only focus on actual skills, tools, technologies, and qualifications.

RESUME CONTENT:
${resumeContent.substring(0, 4000)}${resumeContent.length > 4000 ? '...' : ''}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}${jobDescription.length > 4000 ? '...' : ''}

Your task:
1. Extract HIGH-IMPACT keywords from the job description:
   - Skills (technologies, programming languages, frameworks)
   - Tools & Technologies (software, platforms, services)
   - Certifications (professional certifications, licenses)
   - Methodologies (processes, frameworks, approaches)
   - CRITICAL: Include ALL acronyms EXACTLY as written in the job description (preserve exact capitalization and format)
   - CRITICAL: Include multi-word technical terms and compound phrases exactly as they appear in the job description
   - IGNORE: filler words, dates, locations, job board boilerplate ("posted", "apply", "weeks ago", etc.)

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
- CRITICAL: Include ALL acronyms EXACTLY as written in job description (preserve exact format and capitalization)
- CRITICAL: Include multi-word technical terms and compound phrases exactly as they appear in the job description
- Ignore filler words, dates, locations, and job board boilerplate
- Use semantic understanding - if resume has "electronic design" and job wants "hardware engineering", count it as a match
- However, for acronyms and specific technical terms mentioned in the job description, prefer exact matches over semantic alternatives
- Be realistic - aim for 90%+ match on high-impact keywords, not every word
- Focus on skills, tools, technologies, and methodologies that actually matter for ATS`;
  }

  /**
   * Normalize and validate AI response
   * Validates that matched keywords actually exist in the resume to prevent hallucinations
   */
  private normalizeATSResult(analysis: any, resumeContent: string): SemanticATSResult {
    const resumeLower = resumeContent.toLowerCase();
    
    // Helper to normalize keyword arrays: dedupe and sort for stable ordering
    const normalizeKeywordArray = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      const set = new Set<string>();
      arr.forEach((kw) => {
        if (typeof kw === 'string' && kw.trim().length > 0) {
          set.add(kw.trim());
        }
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };

    // Validate matched keywords - only include those that actually exist in the resume
    const allMatchedKeywords = normalizeKeywordArray(analysis.matchedKeywords);
    const validatedMatchedKeywords = allMatchedKeywords.filter((kw: string) => {
      const kwLower = kw.toLowerCase();
      // Check if keyword exists in resume (exact match or as part of a word)
      return resumeLower.includes(kwLower);
    });

    // Log if we filtered out any hallucinated keywords
    if (validatedMatchedKeywords.length < allMatchedKeywords.length) {
      const filtered = allMatchedKeywords.filter((kw: string) => !validatedMatchedKeywords.includes(kw));
      logger.warn('Filtered out keywords not found in resume:', filtered);
    }

    const missingKeywords = normalizeKeywordArray(analysis.missingKeywords);
    
    // Validate high-impact matched keywords
    const allHiMatched = normalizeKeywordArray(analysis.highImpactKeywords?.matched);
    const validatedHiMatched = allHiMatched.filter((kw: string) => {
      const kwLower = kw.toLowerCase();
      return resumeLower.includes(kwLower);
    });
    
    const hiMissing = normalizeKeywordArray(analysis.highImpactKeywords?.missing);

    return {
      similarityScore: Math.min(100, Math.max(0, analysis.similarityScore || 0)),
      matchedKeywords: validatedMatchedKeywords,
      missingKeywords,
      keywordCoverage: Math.min(100, Math.max(0, analysis.keywordCoverage || 0)),
      semanticMatches: {
        skills: Math.min(100, Math.max(0, analysis.semanticMatches?.skills || 0)),
        experience: Math.min(100, Math.max(0, analysis.semanticMatches?.experience || 0)),
        education: Math.min(100, Math.max(0, analysis.semanticMatches?.education || 0)),
        tools: Math.min(100, Math.max(0, analysis.semanticMatches?.tools || 0)),
      },
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
      highImpactKeywords: {
        matched: validatedHiMatched,
        missing: hiMissing,
      },
    };
  }

  /**
   * Fallback analysis if AI fails (simplified but still better than keyword counting)
   */
  private fallbackAnalysis(
    resumeContent: string,
    jobDescription: string,
    generateFreely: boolean = false
  ): SemanticATSResult {
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

    // Calculate similarity score - return REAL scores, no artificial inflation
    // Apply a small semantic boost to account for synonym matching
    const semanticBoost = 1.05; // Small boost for semantic understanding
    const similarityScore = Math.min(100, keywordCoverage * semanticBoost);

    return {
      similarityScore: Math.round(similarityScore),
      matchedKeywords: matched,
      missingKeywords: missing.slice(0, 10), // Limit to top 10 missing
      keywordCoverage: Math.round(keywordCoverage),
      semanticMatches: {
        skills: Math.round(Math.min(100, keywordCoverage * 0.9)),
        experience: Math.round(Math.min(100, keywordCoverage * 0.95)),
        education: Math.round(Math.min(100, 80)), // Education is often less relevant
        tools: Math.round(Math.min(100, keywordCoverage * 0.85)),
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
    // Domain-agnostic noise filtering using regex patterns (no hardcoded locations/companies)
    const noisePatterns = [
      // Time references
      /\d{1,2}\s*(days?|weeks?|months?|hours?|years?)\s*(ago|old)/i,
      // Job board UI elements
      /(posted|apply|save|share|glance|at a glance|apply by)/i,
      // Location/work arrangement descriptors
      /(remote|onsite|hybrid|us|united states|based in|location|work from home)/i,
      // Dates (month names, day names)
      /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
      // Common stop words
      /^(the|a|an|and|or|but|in|on|at|to|for|of|with|by|from|as|is|was|are|were|been|be|have|has|had|do|does|did|will|would|should|could|may|might|must|can|this|that|these|those|i|you|he|she|it|we|they|what|which|who|whom|whose|where|when|why|how|all|each|every|both|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|now)$/i,
      // Job description filler
      /^(looking|seeking|candidate|position|role|opportunity|company|team|work|environment|culture|benefits|compensation|salary|hour|week|year|experience|required|preferred|qualifications|responsibilities|duties|tasks)$/i,
      // Pure numbers
      /^\d+$/,
    ];

    const isNoise = (word: string): boolean => {
      const lower = word.toLowerCase().trim();
      return noisePatterns.some(pattern => pattern.test(lower)) || lower.length < 3;
    };

    const normalized = text.toLowerCase();
    
    const keywords = new Set<string>();
    
    // Extract acronyms (domain-agnostic)
    const acronymPattern = /\b[A-Z]{2,}(?:\/[A-Z]{2,})*\b/g;
    const acronyms = text.match(acronymPattern) || [];
    acronyms.forEach((acronym) => {
      const clean = acronym.trim();
      if (clean.length >= 2 && !isNoise(clean)) {
        keywords.add(clean); // Keep acronyms in original case
      }
    });

    // Extract capitalized words (likely proper nouns, technologies, tools, company names, etc.)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    capitalizedWords.forEach((word) => {
      const clean = word.trim();
      if (clean.length >= 3 && !isNoise(clean) && !/^\d+$/.test(clean)) {
        keywords.add(clean);
      }
    });

    return Array.from(keywords).slice(0, 50); // Limit to top 50
  }

  /**
   * Check if two keywords are semantically related
   * Uses simple heuristics - domain-agnostic approach
   */
  private isSemanticMatch(keyword1: string, keyword2: string): boolean {
    const k1 = keyword1.toLowerCase();
    const k2 = keyword2.toLowerCase();

    // Exact match
    if (k1 === k2) return true;

    // Check if one contains the other (e.g., "software development" contains "software")
    if (k1.includes(k2) || k2.includes(k1)) {
      // Only consider it a match if the shorter word is at least 4 characters
      // to avoid false matches like "it" matching "fit"
      const shorter = k1.length < k2.length ? k1 : k2;
      if (shorter.length >= 4) {
        return true;
      }
    }

    // Check for shared significant words (domain-agnostic)
    const words1 = k1.split(/\s+/).filter(w => w.length >= 4);
    const words2 = k2.split(/\s+/).filter(w => w.length >= 4);
    const sharedWords = words1.filter(w => words2.includes(w));
    
    // If they share at least one significant word, consider it a semantic match
    if (sharedWords.length > 0) {
      return true;
    }

    return false;
  }
}
