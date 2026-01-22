import OpenAI from 'openai';
import logger from '../utils/logger';
import { ParsedResumeContent, TailoredResumeData } from '../types';

export class OpenAIService {
  private client: OpenAI;
  private baseUrl = 'https://api.openai.com/v1';

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. Please add it to your .env file.'
      );
    }

    this.client = new OpenAI({
      apiKey,
    });
  }

  async tailorResume(
    resumeContent: ParsedResumeContent,
    jobDescription: string,
    generateFreely: boolean = false
  ): Promise<TailoredResumeData> {
    const serviceStartTime = Date.now();

    try {
      // Format resume content
      const formatStartTime = Date.now();
      const resumeText = this.formatResumeContent(resumeContent);
      
      // Extract keywords from job description for better matching
      const jobKeywords = this.extractImportantKeywords(jobDescription);
      
      const prompt = this.buildTailoringPrompt(resumeText, jobDescription, generateFreely, jobKeywords);

      const formatTime = Date.now();
      logger.info('OpenAI: Resume formatted and prompt built', {
        duration_ms: formatTime - formatStartTime,
        resume_text_length: resumeText.length,
        prompt_length: prompt.length,
      });

      // Call OpenAI API
      const apiStartTime = Date.now();
      logger.info('OpenAI: Making API request', {
        model: 'gpt-4o-mini',
        base_url: this.baseUrl,
        elapsed_ms: apiStartTime - serviceStartTime,
      });

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: generateFreely
              ? "You are an expert resume writer and career advisor. Your task is to tailor resume content to match job descriptions. In flexible mode, you may enhance and expand on the user's actual experience to better match the role, but you must stay grounded in their real qualifications and never invent completely new experiences or companies."
              : "You are an expert resume writer and career advisor. Your task is to tailor resume content to match job descriptions while being truthful and only using information from the provided resume. Never invent experience or skills that are not present in the original resume.",
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const apiTime = Date.now();
      logger.info('OpenAI: API response received', {
        duration_ms: apiTime - apiStartTime,
        elapsed_ms: apiTime - serviceStartTime,
      });

      const content = response.choices[0]?.message?.content || '';

      logger.info('OpenAI: Full AI response received', {
        generate_freely: generateFreely,
        mode: generateFreely ? 'flexible' : 'strict',
        response_length: content.length,
        full_response: content,
      });

      // Parse the response
      const parseStartTime = Date.now();
      const parsedResult = this.parseAIResponse(content);
      const parseTime = Date.now();
      const totalServiceTime = Date.now();

      logger.info('OpenAI: Response parsed and completed', {
        parse_duration_ms: parseTime - parseStartTime,
        response_length: content.length,
        total_duration_ms: totalServiceTime - serviceStartTime,
        total_duration_seconds: (totalServiceTime - serviceStartTime) / 1000,
        breakdown: {
          format_ms: formatTime - formatStartTime,
          api_call_ms: apiTime - apiStartTime,
          parse_ms: parseTime - parseStartTime,
        },
      });

      return parsedResult;
    } catch (error: any) {
      logger.error('OpenAI Service Error:', error);
      throw error;
    }
  }

  private formatResumeContent(resumeContent: ParsedResumeContent): string {
    // Use raw_text if available (full resume), otherwise build from structured data
    if (resumeContent.raw_text && resumeContent.raw_text.trim()) {
      return resumeContent.raw_text;
    }

    // Fallback: build from structured data
    let text = '';

    if (resumeContent.summary) {
      text += 'PROFESSIONAL SUMMARY\n' + resumeContent.summary + '\n\n';
    }

    if (resumeContent.experience && Array.isArray(resumeContent.experience)) {
      text += 'PROFESSIONAL EXPERIENCE\n';
      for (const exp of resumeContent.experience) {
        const title = (exp.title || '') + (exp.company ? ' at ' + (exp.company || '') : '');
        if (title) {
          text += title + '\n';
        }
        if (exp.bullets && Array.isArray(exp.bullets)) {
          for (const bullet of exp.bullets) {
            text += '• ' + bullet + '\n';
          }
        }
        text += '\n';
      }
    }

    if (resumeContent.skills && Array.isArray(resumeContent.skills)) {
      text += 'SKILLS\n' + resumeContent.skills.join(' • ') + '\n\n';
    }

    if (resumeContent.achievements && Array.isArray(resumeContent.achievements)) {
      text += 'ACHIEVEMENTS\n';
      for (const achievement of resumeContent.achievements) {
        text += '• ' + achievement + '\n';
      }
    }

    return text;
  }

  /**
   * Extract important keywords from job description
   */
  private extractImportantKeywords(jobDescription: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
    ]);

    const normalized = jobDescription
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');

    const words = normalized
      .split(' ')
      .filter(word => word.length >= 3 && !stopWords.has(word) && !/^\d+$/.test(word));

    // Count frequency and return unique keywords
    const keywordSet = new Set<string>();
    words.forEach(word => {
      if (word.length >= 3) {
        keywordSet.add(word);
      }
    });

    return Array.from(keywordSet).slice(0, 100); // Limit to top 100 keywords
  }

  private buildTailoringPrompt(
    resumeText: string,
    jobDescription: string,
    generateFreely: boolean,
    jobKeywords: string[] = []
  ): string {
    if (generateFreely) {
      return `You are helping a job seeker tailor their resume to a specific job description and generate a professional cover letter.

CRITICAL RULES FOR FLEXIBLE MODE (100% MATCH MODE - TARGET 95-99% SEMANTIC ATS MATCH):
1. YOUR PRIMARY GOAL: Achieve 95-99% semantic match with the job description. This is MANDATORY - the resume MUST score at least 95% match. Modern ATS systems use semantic understanding, not just exact keyword counting.
2. AGGRESSIVE SEMANTIC MATCHING STRATEGY:
   - Include high-impact keywords: skills, tools, technologies, certifications, methodologies
   - Use semantic synonyms: "hardware engineering" = "electronic design", "cloud computing" = "AWS/Azure/GCP"
   - Match concepts, not just words: "team leadership" matches "managed team" or "led team"
   - IGNORE noise: filler words, dates, locations, job board boilerplate ("posted", "apply", "weeks ago")
3. BASE everything on the user's actual resume, but ENHANCE aggressively:
   - If the job requires a skill/tool that's not in the resume, ADD it to the skills section (you can infer the user likely has exposure to it based on their background)
   - If the job requires experience with something not explicitly mentioned, ADD it to relevant experience bullets
   - If the user has similar experience, REFRAME it to match exactly what the job requires
4. KEYWORD INCLUSION STRATEGY:
   - Extract ALL important keywords from the job description (technologies, tools, methodologies, skills, certifications)
   - Include these keywords NATURALLY throughout the resume: in summary, skills section, experience bullets, and project descriptions
   - Use the EXACT terminology from the job description (e.g., if job says "LLMs", use "LLMs" not "large language models")
   - Repeat important keywords 2-3 times throughout the resume for better ATS scoring
5. ADD all relevant keywords, skills, tools, and technologies from the job description to the resume - NO EXCEPTIONS
6. ENHANCE experience bullets to include job-required skills and achievements - weave in missing keywords naturally
7. REORGANIZE and EMPHASIZE sections to highlight qualifications that match the job
8. Use measurable language (numbers, percentages, metrics) - you can add reasonable metrics if they help match the job
9. Match the EXACT language and terminology used in the job description for maximum ATS optimization
10. Keep personal information (name, contact, address) exactly as provided
11. Preserve ALL major sections, experience, and projects from the original resume (but enhance them)
12. CRITICAL: Your resume must pass ATS filters - this means including 90-99% of job description keywords
13. If the job requires specific certifications, software, or methodologies not in the resume, ADD them if they're reasonable for the user's background
14. Create a "Keywords" or "Technologies" section if needed to ensure all important terms are included
15. In the professional summary, include 5-10 key terms from the job description naturally

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

${jobKeywords.length > 0 ? `\nCRITICAL KEYWORDS TO INCLUDE (extracted from job description - you MUST naturally incorporate at least 90% of these):\n${jobKeywords.slice(0, 50).join(', ')}\n\nThese keywords are ESSENTIAL for achieving 90-99% ATS match score. Include them naturally throughout the resume in summary, skills, experience bullets, and project descriptions.` : ''}

Your task: Return a STRUCTURED JSON object with the tailored resume data and cover letter. Use this EXACT format (no markdown, just valid JSON):

{
  "header": {
    "name": "Full name from resume",
    "title": "Professional title or role (optional)",
    "contact": {
      "phone": "Phone number if present",
      "email": "Email address",
      "linkedin": "LinkedIn username if present",
      "github": "GitHub username if present",
      "location": "City, State/Country if present"
    }
  },
  "summary": "Tailored professional summary paragraph (2-4 sentences, rephrased to match job requirements)",
  "education": [
    {
      "degree": "Degree name",
      "school": "School name",
      "location": "Location if present",
      "year": "Graduation year or date"
    }
  ],
  "skills": {
    "languages": ["Language 1", "Language 2"],
    "frameworks": ["Framework 1", "Framework 2"],
    "devops": ["Tool 1", "Tool 2"],
    "databases": ["Database 1", "Database 2"],
    "other": ["Skill 1", "Skill 2"]
  },
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "Location if present",
      "period": "Start date – End date or Present",
      "bullets": [
        "Tailored bullet point 1 (rephrased to match job)",
        "Tailored bullet point 2",
        "Tailored bullet point 3"
      ]
    }
  ],
  "projects": [
    {
      "name": "Project name",
      "url": "URL if present"
    }
  ],
  "languages": [
    {
      "language": "Language name",
      "proficiency": "Proficiency level"
    }
  ],
  "coverLetter": "A professional cover letter (3-4 paragraphs) expressing interest, highlighting 2-3 relevant experiences/skills, and showing fit for the role. Use the person's name from the resume."
}

IMPORTANT FOR FLEXIBLE MODE:
- Include ALL information from the original resume PLUS add any missing skills/experiences required by the job
- If a section doesn't exist in the original resume, create it if the job requires it
- For skills, organize them into the provided categories AND ADD any job-required skills that are missing
- For experience, include ALL positions with ALL bullet points ENHANCED to match the job requirements
- ADD new bullet points or skills if needed to meet 100% of job requirements
- Keep the structure consistent and complete
- Your goal is to make the user appear as a perfect match for the role`;
    } else {
      return `You are helping a job seeker tailor their resume to a specific job description and generate a professional cover letter.

CRITICAL RULES FOR STRICT MODE:
1. ONLY use information from the provided resume - do not invent or add any experience, skills, achievements, education, or personal details that are not present
2. Rephrase and emphasize existing content to align with the job description
3. Use measurable language (numbers, percentages, metrics) where available in the original resume
4. Match the language and terminology used in the job description
5. Focus on ATS (Applicant Tracking System) optimization by using keywords from the job description that match existing resume content
6. Keep personal information (name, contact, address) exactly as provided
7. Preserve ALL sections, skills, experience, and projects - nothing should be missing
8. DO NOT add new skills, experiences, or qualifications that are not in the original resume
9. DO NOT enhance or expand beyond what is explicitly stated in the resume
10. Your job is to rephrase and reorganize, not to add new content

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

${jobKeywords.length > 0 ? `\nCRITICAL KEYWORDS TO INCLUDE (extracted from job description - you MUST naturally incorporate at least 90% of these):\n${jobKeywords.slice(0, 50).join(', ')}\n\nThese keywords are ESSENTIAL for achieving 90-99% ATS match score. Include them naturally throughout the resume in summary, skills, experience bullets, and project descriptions.` : ''}

Your task: Return a STRUCTURED JSON object with the tailored resume data and cover letter. Use this EXACT format (no markdown, just valid JSON):

{
  "header": {
    "name": "Full name from resume",
    "title": "Professional title or role (optional)",
    "contact": {
      "phone": "Phone number if present",
      "email": "Email address",
      "linkedin": "LinkedIn username if present",
      "github": "GitHub username if present",
      "location": "City, State/Country if present"
    }
  },
  "summary": "Tailored professional summary paragraph (2-4 sentences, rephrased to match job requirements)",
  "education": [
    {
      "degree": "Degree name",
      "school": "School name",
      "location": "Location if present",
      "year": "Graduation year or date"
    }
  ],
  "skills": {
    "languages": ["Language 1", "Language 2"],
    "frameworks": ["Framework 1", "Framework 2"],
    "devops": ["Tool 1", "Tool 2"],
    "databases": ["Database 1", "Database 2"],
    "other": ["Skill 1", "Skill 2"]
  },
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "Location if present",
      "period": "Start date – End date or Present",
      "bullets": [
        "Tailored bullet point 1 (rephrased to match job)",
        "Tailored bullet point 2",
        "Tailored bullet point 3"
      ]
    }
  ],
  "projects": [
    {
      "name": "Project name",
      "url": "URL if present"
    }
  ],
  "languages": [
    {
      "language": "Language name",
      "proficiency": "Proficiency level"
    }
  ],
  "coverLetter": "A professional cover letter (3-4 paragraphs) expressing interest, highlighting 2-3 relevant experiences/skills, and showing fit for the role. Use the person's name from the resume."
}

IMPORTANT:
- Extract ALL information from the original resume - nothing should be missing
- If a section doesn't exist in the original resume, use an empty array or omit the field
- For skills, organize them into the provided categories (languages, frameworks, devops, databases, other)
- For experience, include ALL positions with ALL bullet points (just rephrased/tailored)
- Keep the structure consistent and complete
- DO NOT add anything that is not in the original resume`;
    }
  }

  private parseAIResponse(content: string): TailoredResumeData {
    // Try to extract JSON from the response
    let cleaned = content.trim();

    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```json\n?/gi, '');
    cleaned = cleaned.replace(/```\n?/g, '');

    // Try to find JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[0]);
        if (json && typeof json === 'object') {
          // Return structured data
          return {
            structured: json,
            coverLetter: json.coverLetter || '',
            fullResume: this.generatePlainTextResume(json),
          };
        }
      } catch (e) {
        logger.warn('Failed to parse JSON from AI response', { error: e });
      }
    }

    // Fallback: if JSON parsing fails
    logger.warn('Failed to parse structured JSON from AI response, using fallback');
    return {
      structured: null,
      coverLetter: '',
      fullResume: content,
    };
  }

  private generatePlainTextResume(structured: any): string {
    let text = '';

    // Header
    if (structured.header) {
      const header = structured.header;
      if (header.name) {
        text += header.name.toUpperCase() + '\n\n';
      }

      const contact: string[] = [];
      if (header.contact?.phone) contact.push(header.contact.phone);
      if (header.contact?.email) contact.push(header.contact.email);
      if (header.contact?.linkedin) contact.push('Linkedin:' + header.contact.linkedin);
      if (header.contact?.github) contact.push('GitHub: ' + header.contact.github);
      if (header.contact?.location) contact.push(header.contact.location);

      if (contact.length > 0) {
        text += contact.join(' ') + '\n\n';
      }
    }

    // Summary
    if (structured.summary) {
      text += 'PROFESSIONAL SUMMARY\n';
      text += structured.summary + '\n\n';
    }

    // Education
    if (structured.education && Array.isArray(structured.education)) {
      text += 'EDUCATION\n';
      for (const edu of structured.education) {
        const parts: string[] = [];
        if (edu.degree) parts.push(edu.degree);
        if (edu.school) parts.push(edu.school);
        if (edu.location) parts.push(edu.location);
        if (edu.year) parts.push(edu.year);
        text += parts.join(' | ') + '\n';
      }
      text += '\n';
    }

    // Skills
    if (structured.skills) {
      text += 'TECHNICAL SKILL\n';
      const skills = structured.skills;

      if (skills.languages && skills.languages.length > 0) {
        text += 'Languages & Frameworks\n';
        for (const skill of skills.languages) {
          text += '• ' + skill + '\n';
        }
      }

      if (skills.frameworks && skills.frameworks.length > 0) {
        for (const skill of skills.frameworks) {
          text += '• ' + skill + '\n';
        }
      }

      if (skills.devops && skills.devops.length > 0) {
        text += 'DevOps & Tools\n';
        for (const skill of skills.devops) {
          text += '• ' + skill + '\n';
        }
      }

      if (skills.databases && skills.databases.length > 0) {
        text += 'DATABASES\n';
        for (const skill of skills.databases) {
          text += '• ' + skill + '\n';
        }
      }

      if (skills.other && skills.other.length > 0) {
        text += 'OTHER SKILLS\n';
        for (const skill of skills.other) {
          text += '• ' + skill + '\n';
        }
      }
      text += '\n';
    }

    // Experience
    if (structured.experience && Array.isArray(structured.experience)) {
      text += 'PROFESSIONAL EXPERIENCE\n';
      for (const exp of structured.experience) {
        const titleParts: string[] = [];
        if (exp.role) titleParts.push(exp.role);
        if (exp.company) titleParts.push(exp.company);
        if (exp.location) titleParts.push(exp.location);
        if (exp.period) titleParts.push(exp.period);
        text += titleParts.join(' | ') + '\n';

        if (exp.bullets && Array.isArray(exp.bullets)) {
          for (const bullet of exp.bullets) {
            text += '• ' + bullet + '\n';
          }
        }
        text += '\n';
      }
    }

    // Projects
    if (structured.projects && Array.isArray(structured.projects)) {
      text += 'PROJECT HIGHLIGHTS\n';
      for (const project of structured.projects) {
        let projText = project.name || '';
        if (project.url) {
          projText += (projText ? ': ' : '') + project.url;
        }
        text += projText + '\n';
      }
      text += '\n';
    }

    // Languages
    if (structured.languages && Array.isArray(structured.languages)) {
      text += 'LANGUAGE\n';
      for (const lang of structured.languages) {
        let langText = lang.language || '';
        if (lang.proficiency) {
          langText += (langText ? ' — ' : '') + lang.proficiency;
        }
        text += langText + '\n';
      }
    }

    return text.trim();
  }
}
