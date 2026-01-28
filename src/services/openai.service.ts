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
      
      // Detect role level for seniority-aware language
      const roleLevel = this.detectRoleLevel(jobDescription);
      const seniorityRules = this.getSeniorityLanguageRules(roleLevel);
      
      logger.info('Role level detected', {
        role_level: roleLevel,
        seniority_rules: seniorityRules,
      });
      
      const prompt = this.buildTailoringPrompt(resumeText, jobDescription, generateFreely, jobKeywords, roleLevel, seniorityRules);

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
        response_format: { type: 'json_object' },
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

  /**
   * Regenerate resume with focused prompt to add missing keywords
   */
  async regenerateResume(
    resumeContent: ParsedResumeContent,
    currentResumeText: string,
    jobDescription: string,
    generateFreely: boolean = false,
    missingKeywords: string[] = [],
    matchedKeywords: string[] = []
  ): Promise<TailoredResumeData> {
    const serviceStartTime = Date.now();

    try {
      // Format resume content
      const formatStartTime = Date.now();
      const resumeText = currentResumeText || this.formatResumeContent(resumeContent);
      
      // Extract keywords from job description
      const jobKeywords = this.extractImportantKeywords(jobDescription);
      
      // Detect role level for intelligent tailoring
      const roleLevel = this.detectRoleLevel(jobDescription);
      const seniorityRules = this.getSeniorityLanguageRules(roleLevel);
      
      // Build focused regeneration prompt
      const prompt = this.buildRegenerationPrompt(
        resumeText,
        jobDescription,
        generateFreely,
        jobKeywords,
        missingKeywords,
        matchedKeywords,
        roleLevel,
        seniorityRules
      );

      const formatTime = Date.now();
      logger.info('OpenAI: Resume formatted and regeneration prompt built', {
        duration_ms: formatTime - formatStartTime,
        resume_text_length: resumeText.length,
        prompt_length: prompt.length,
        missing_keywords_count: missingKeywords.length,
      });

      // Call OpenAI API
      const apiStartTime = Date.now();
      logger.info('OpenAI: Making regeneration API request', {
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
              ? `You are a professional resume editor and ATS optimization specialist. Your task is to intelligently enhance a resume to achieve high keyword match while maintaining natural, human-sounding language.

🎯 FLEXIBLE MODE OBJECTIVE:
Intelligently add missing keywords from the job description to achieve 95-100% ATS match, but frame them at an implementation/integration level, not as deep specialization. The resume must sound like it was written by a human career strategist, not an AI keyword stuffer.

✅ ALLOWED INTELLIGENT ADDITIONS (With Plausibility Guardrails):

1. ADJACENT SKILLS/TOOLS (Safe to Add Naturally):
   - If resume shows experience in a domain/category, can add related tools/skills from the same category
   - Examples: Cloud platforms → related cloud services, Design tools → related design software, Marketing platforms → related marketing tools, Medical systems → related healthcare software
   - Frame as: "integrated", "worked with", "implemented using", "leveraged services such as", "utilized", "collaborated with"

2. SKILLS SECTION:
   - Can add missing skills/tools to skills section if they are adjacent to existing skills in the same category
   - This is safe - skills lists are expected to be comprehensive
   - Works for ALL domains: technical tools, software platforms, methodologies, certifications, etc.

3. EXPERIENCE BULLETS:
   - Can enhance bullets to include missing keywords BUT use soft integration language
   - Prefer: "Integrated [category] services including [keyword]" NOT "Built [keyword] systems"
   - Prefer: "Worked with [tool/platform]" NOT "Architected [tool/platform] infrastructure"
   - Prefer: "Implemented features using [tool]" NOT "Designed [tool] from scratch"
   - Prefer: "Utilized [methodology]" NOT "Created [methodology] framework"

🚫 FORBIDDEN (Even in Flexible Mode):
- Do NOT add deep specialization claims that require extensive expertise (e.g., specialized certifications, advanced methodologies, expert-level roles)
- Do NOT add domain expertise not supported by resume (e.g., healthcare compliance if no healthcare background, financial regulations if no finance background)
- Do NOT create new achievements, metrics, or projects
- Do NOT imply seniority beyond what the resume shows
- Do NOT use deep-expert phrasing for newly added skills (e.g., "architected", "designed from scratch", "created framework" for newly added items)

🔑 KEYWORD INTEGRATION RULES (Domain-Agnostic):
- Use softer integration language: "integrated", "worked with", "implemented using", "leveraged", "utilized", "collaborated with"
- Frame at implementation/integration level, not deep specialization
- Make it sound like natural career positioning, not fabrication
- If a keyword is too far from existing experience, add it only to skills section, not experience bullets
- Works for ALL domains: technical, healthcare, finance, marketing, design, operations, etc.

🎯 QUALITY CHECK:
The resume should read like a human career strategist positioned the candidate for this role, not like an AI stuffed keywords. Naturalness and believability are more important than 100% keyword coverage.`
              : `You are a professional resume editor in STRICT MODE. Your task is to improve alignment between a resume and job description while maintaining 100% factual accuracy.

🚨 STRICT MODE RULES (CRITICAL - NO EXCEPTIONS):

MODE LOCK: You are in STRICT MODE. This means you MUST preserve factual accuracy above all else.

🚫 ABSOLUTELY FORBIDDEN (DO NOT DO THESE):
- Do NOT add any new skills, tools, technologies, certifications, degrees, job titles, companies, or responsibilities that are not explicitly present in the original resume
- Do NOT add technologies/tools mentioned in job description if they are not in the original resume (e.g., if JD mentions "Figma" but resume doesn't, DO NOT add it)
- Do NOT add frameworks to specific job entries unless they were already tied to that job in the original resume
- Do NOT add industries or domains not mentioned in the original resume
- Do NOT invent domain experience unless clearly stated in the resume
- Do NOT create new achievements, metrics, or projects
- Do NOT add new responsibilities or capabilities not stated in the original resume

✅ ALLOWED IN STRICT MODE (ONLY THESE):
- Rephrase existing content to better align with job description
- Reorder or reorganize existing information for better relevance
- Emphasize existing skills/experiences that match the job
- Map existing skills to job terminology (e.g., "REST APIs" → "RESTful API development")
- Improve clarity and flow of existing bullets
- Replace weak verbs with stronger ones (but never downgrade)

🎯 KEY PRINCIPLE:
You may ONLY work with what is already in the resume. You may rephrase, reorganize, and emphasize, but you may NOT introduce new technologies, tools, industries, responsibilities, or capabilities. The resume is the ONLY source of truth.

✅ ALLOWED IMPROVEMENTS:
- Rephrase existing bullet points to better align with job description
- Make achievements more results-oriented using the original meaning
- Emphasize experience that matches the job description IF it already exists
- Replace weak verbs with stronger ones (but never downgrade)
- Improve keyword alignment ONLY where there is clear evidence in the resume

🔑 KEYWORD RULE:
You may only use a keyword from the job description if the resume already demonstrates that skill or experience, even if phrased differently. If there is no clear evidence, OMIT the keyword. ACCURACY IS MORE IMPORTANT THAN MATCH SCORE.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2, // Low temperature for factual adherence and accuracy
        max_tokens: 4000, // Increased to ensure full content is generated with all keywords added
        response_format: { type: 'json_object' },
      });

      const apiTime = Date.now();
      logger.info('OpenAI: Regeneration API response received', {
        duration_ms: apiTime - apiStartTime,
        elapsed_ms: apiTime - serviceStartTime,
      });

      const content = response.choices[0]?.message?.content || '';

      logger.info('OpenAI: Full regeneration response received', {
        generate_freely: generateFreely,
        mode: generateFreely ? 'flexible' : 'strict',
        response_length: content.length,
      });

      // Parse the response
      const parseStartTime = Date.now();
      const parsedResult = this.parseAIResponse(content);
      const parseTime = Date.now();
      const totalServiceTime = Date.now();

      logger.info('OpenAI: Regeneration response parsed and completed', {
        parse_duration_ms: parseTime - parseStartTime,
        response_length: content.length,
        total_duration_ms: totalServiceTime - serviceStartTime,
      });

      return parsedResult;
    } catch (error: any) {
      logger.error('OpenAI Regeneration Service Error:', error);
      throw error;
    }
  }

  /**
   * Analyze job context to provide role-aware guidance for regeneration
   */
  private analyzeJobContext(
    jobDescription: string,
    roleLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'staff'
  ): string {
    const jdLower = jobDescription.toLowerCase();
    
    // Detect company stage
    let companyStage = 'enterprise';
    if (jdLower.includes('startup') || jdLower.includes('early stage') || jdLower.includes('fast-paced') || jdLower.includes('ship fast')) {
      companyStage = 'startup';
    } else if (jdLower.includes('growth') || jdLower.includes('scaling')) {
      companyStage = 'growth';
    }
    
    // Detect role type
    let roleType = 'full-time';
    if (jdLower.includes('contract') || jdLower.includes('contractor') || jdLower.includes('freelance')) {
      roleType = 'contract';
    } else if (jdLower.includes('intern') || jdLower.includes('internship')) {
      roleType = 'internship';
    } else if (jdLower.includes('part-time') || jdLower.includes('part time')) {
      roleType = 'part-time';
    }
    
    // Detect key focus areas
    const focusAreas: string[] = [];
    if (jdLower.includes('ai') || jdLower.includes('machine learning') || jdLower.includes('ml')) {
      focusAreas.push('AI/ML features');
    }
    if (jdLower.includes('performance') || jdLower.includes('optimization') || jdLower.includes('scalability')) {
      focusAreas.push('Performance & Scalability');
    }
    if (jdLower.includes('product roadmap') || jdLower.includes('roadmap') || jdLower.includes('product decisions')) {
      focusAreas.push('Product Strategy');
    }
    if (jdLower.includes('ship') || jdLower.includes('deliver') || jdLower.includes('build features')) {
      focusAreas.push('Feature Delivery');
    }
    if (jdLower.includes('video') || jdLower.includes('transcription') || jdLower.includes('translation')) {
      focusAreas.push('Media Processing');
    }
    
    // Determine required tone
    let requiredTone = 'ownership-driven';
    if (roleLevel === 'intern' || roleType === 'internship') {
      requiredTone = 'learning-focused';
    } else if (companyStage === 'startup' || roleType === 'contract') {
      requiredTone = 'ownership-driven';
    } else if (jdLower.includes('lead') || jdLower.includes('mentor') || jdLower.includes('architect')) {
      requiredTone = 'leadership-focused';
    }
    
    return `- Role Type: ${roleType} (${roleLevel} level)
- Company Stage: ${companyStage}
- Key Focus Areas: ${focusAreas.length > 0 ? focusAreas.join(', ') : 'General development'}
- Required Tone: ${requiredTone}
- Language Style: ${requiredTone === 'ownership-driven' ? 'Use strong action verbs (Led, Built, Implemented, Architected) - show ownership and results' : requiredTone === 'learning-focused' ? 'Use learning/contribution language appropriately for intern level' : 'Balance leadership language with practical implementation'}

IMPORTANT: Based on this context, ${requiredTone === 'ownership-driven' ? 'MAINTAIN or STRENGTHEN ownership language. Do NOT downgrade action verbs.' : requiredTone === 'learning-focused' ? 'Use appropriate learning language for intern level, but do not downgrade if original resume uses stronger verbs.' : 'Maintain appropriate leadership language while showing practical impact.'}`;
  }

  /**
   * Build focused regeneration prompt that emphasizes adding missing keywords
   */
  private buildRegenerationPrompt(
    resumeText: string,
    jobDescription: string,
    generateFreely: boolean,
    jobKeywords: string[],
    missingKeywords: string[] = [],
    matchedKeywords: string[] = [],
    roleLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'staff' = 'mid',
    seniorityRules?: { verbs: string[]; avoidVerbs: string[]; scope: string; leadership: boolean; architecture: boolean; keywordStrength: 'exploratory' | 'practical' | 'strategic' }
  ): string {
    const rules = seniorityRules || this.getSeniorityLanguageRules(roleLevel);
    // Domain-agnostic noise filtering using regex patterns
    const filteredMissingKeywords = missingKeywords.filter(kw => {
      return this.isLikelySkillKeyword(kw);
    });

    // Create a numbered list of missing keywords for clarity
    const missingKeywordsList = filteredMissingKeywords.length > 0 
      ? filteredMissingKeywords.map((kw, idx) => `${idx + 1}. "${kw}"`).join('\n')
      : 'None specified - but ensure ALL keywords from job description are included';

    // Use intelligent regeneration approach - make resume better while adding keywords
    if (generateFreely) {
      // Analyze job context for role-aware regeneration
      const roleContext = this.analyzeJobContext(jobDescription, roleLevel);
      
      return `You are a senior technical recruiter and resume strategist. Your job is to intelligently enhance this resume for the provided job description by adding missing keywords naturally while maintaining human-sounding, believable language.

🎯 PRIMARY OBJECTIVES (IN ORDER OF PRIORITY):
1. Achieve 95-100% keyword match through intelligent, plausible additions
2. Maintain natural, human-sounding language - avoid obvious AI keyword stuffing
3. Frame added keywords at implementation/integration level, not deep specialization
4. Preserve confident, ownership-driven tone - never downgrade action verbs
5. Preserve all core information (experiences, companies, dates, projects, education)
6. The resume must read like a human career strategist positioned the candidate, not an AI

🎯 FLEXIBLE MODE GUIDANCE:
You are in FLEXIBLE MODE - you can intelligently add missing keywords, but with plausibility guardrails. Frame additions as natural career positioning, not fabrication.

📋 JOB CONTEXT ANALYSIS (CRITICAL - Use this to guide your regeneration):
${roleContext}

🚨 MISSING KEYWORDS TO INTEGRATE (Intelligently add with plausibility guardrails):
${missingKeywordsList}

🔑 KEYWORD INTEGRATION RULES FOR FLEXIBLE MODE:

🟢 TIER 1 - ADJACENT SKILLS/TOOLS (Safe to Add Naturally):
These can be added if the resume shows related experience in the same category/domain:
- If resume has experience with tools/platforms in a category → Can add related tools from same category
- If resume has experience with methodologies → Can add related methodologies
- If resume has experience with software types → Can add related software
- If resume has domain experience → Can add related domain-specific tools/skills
- Principle: Related items within the same category are safe to add

✅ CORRECT LANGUAGE FOR TIER 1 (Works for ALL domains):
- "Integrated [category] services including [keyword]" (e.g., "Integrated marketing platforms including [tool]")
- "Worked with [related tools] such as [keyword]" (e.g., "Worked with design software such as [tool]")
- "Implemented features using [tool/platform]" (e.g., "Implemented features using [software]")
- "Leveraged [category] tools to enhance [functionality]" (e.g., "Leveraged analytics tools to enhance reporting")

🟡 TIER 2 - STRETCH BUT DEFENSIBLE (Add with Soft Language):
Related but not directly supported - use softer integration language:
- If resume has experience in a broader category → Can mention specific sub-skills (not deep specialization)
- Principle: Frame as exposure/integration, not expertise

✅ CORRECT LANGUAGE FOR TIER 2 (Works for ALL domains):
- "Integrated [category] services including [specific sub-skill]" (e.g., "Integrated healthcare systems including [specific module]")
- "Worked with [specific tool] to enhance [existing feature]" (e.g., "Worked with [advanced feature] to enhance [existing work]")
- NOT: "Built [specialized system]" or "Designed [specialized framework]" or "Created [specialized methodology]"

🔴 TIER 3 - HIGH RISK (Add Only to Skills Section, Not Experience):
These should only appear in skills section, not experience bullets:
- Deep specialization claims
- Domain expertise not supported by resume
- Advanced concepts that require specific background

⚠️ DOMAIN-AGNOSTIC FILTERING: Ignore any non-skill keywords like dates, locations, company names, application instructions, or posting metadata. Only treat as missing if they are actual required skills/tools/qualifications. This app works for ALL job types (software, healthcare, finance, marketing, etc.) - use semantic understanding to distinguish real skills from job posting boilerplate.

🎯 KEY PRINCIPLE:
Frame added keywords as implementation/integration work, not deep specialization. Use phrases like "integrated", "worked with", "implemented using", "leveraged services" - NOT "architected", "designed from scratch", "built core systems". The goal is natural career positioning, not fabrication.

🎯 ROLE LEVEL DETECTED: ${roleLevel.toUpperCase()} - Use appropriate language for this role level:
- PREFERRED VERBS: ${rules.verbs.join(', ')}
- AVOID THESE VERBS: ${rules.avoidVerbs.length > 0 ? rules.avoidVerbs.join(', ') : 'None - all verbs acceptable for this level'}
- SCOPE: ${rules.scope}
- KEYWORD STRENGTH: ${rules.keywordStrength === 'exploratory' ? 'Use exploratory language (e.g., "exposure to", "familiar with", "explored")' : rules.keywordStrength === 'practical' ? 'Use practical language (e.g., "built", "implemented", "worked with")' : 'Use strategic language (e.g., "architected", "led", "designed")'}
- For ${roleLevel === 'intern' ? 'intern roles, use learning/contribution language - show eagerness to learn, not claims of building production systems' : roleLevel === 'junior' ? 'junior roles, focus on feature-level work and collaboration' : roleLevel === 'senior' || roleLevel === 'staff' ? 'senior roles, you can use leadership and architecture language' : 'mid-level roles, balance practical implementation with some design ownership'}

VERIFICATION CHECKLIST (Only add keywords that map to existing resume content):
${filteredMissingKeywords.map((kw, idx) => `[ ] "${kw}" - Only add if it maps to existing resume content, otherwise OMIT`).join('\n')}

JOB DESCRIPTION (READ CAREFULLY - This defines what the role needs):
${jobDescription}

CURRENT RESUME CONTENT (Use this as your foundation):
${resumeText}

${matchedKeywords.length > 0 ? `\n✅ MATCHED KEYWORDS (Already present - maintain these naturally):
${matchedKeywords.map((kw, idx) => `${idx + 1}. "${kw}"`).join('\n')}

These keywords are already well-matched. Ensure they remain naturally integrated in the regenerated resume.\n` : ''}

🚨 CRITICAL LANGUAGE PROTECTION RULES (NEVER VIOLATE THESE):

1. VERB PROTECTION - DO NOT DOWNGRADE OWNERSHIP:
   ❌ FORBIDDEN DOWNGRADES (Never do these):
   - "Led" → "Helped/Participated/Assisted"
   - "Built" → "Worked on/Contributed to"
   - "Implemented" → "Assisted with/Supported"
   - "Architected" → "Supported/Helped design"
   - "Owned" → "Worked on/Contributed to"
   - "Designed" → "Assisted with design"
   
   ✅ CORRECT APPROACH:
   - If a bullet says "Led development", keep it as "Led" or strengthen to "Led and architected"
   - If a bullet says "Built APIs", keep it as "Built" or enhance to "Built and optimized"
   - If a bullet says "Implemented features", keep it as "Implemented" or enhance to "Implemented and scaled"
   - ONLY use weaker verbs (contributed, assisted, participated) if the role is explicitly intern/junior AND the original resume already used those verbs
   - For contract/startup roles: MAINTAIN or STRENGTHEN ownership language

2. OWNERSHIP & IMPACT PRESERVATION:
   - Maintain strong action verbs that show ownership and results
   - Preserve impact language (numbers, metrics, outcomes)
   - Keep confident, professional tone
   - Do NOT add filler phrases like "gained experience in" or "exposure to" unless the role is explicitly an internship

3. ROLE-APPROPRIATE LANGUAGE:
   - For ${roleLevel === 'intern' ? 'intern roles: Use learning/contribution language if original resume already uses it' : roleLevel === 'junior' ? 'junior roles: Maintain practical implementation language' : roleLevel === 'senior' || roleLevel === 'staff' ? 'senior roles: Maintain or strengthen leadership/architecture language' : 'mid-level roles: Maintain ownership and implementation language'}
   - Match the tone of the job description - if it emphasizes "ship fast", "own features", "make decisions", use strong ownership language
   - If job description emphasizes "learning", "mentorship", "growth", balance ownership with collaboration

🎯 INTELLIGENT REGENERATION STRATEGY:

1. CORE INFORMATION PRESERVATION:
   - Preserve all experiences, companies, dates, projects, education, and contact information
   - Maintain the overall structure and sections
   - Keep all matched keywords naturally integrated: ${matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'N/A'}

2. INTELLIGENT KEYWORD INTEGRATION (With Plausibility Guardrails):
   - Skills Section: Add ALL missing keywords here if they are adjacent to existing skills (this is safe - skills lists are comprehensive)
   - Summary: Integrate 3-5 most important missing keywords naturally, using soft integration language
   - Experience Bullets: Enhance bullets to include missing keywords using integration-level language
   - Use soft language: "integrated", "worked with", "implemented using", "leveraged", "utilized", "collaborated with"
   - ONE keyword per bullet maximum - don't cram multiple concepts into one bullet
   - Each keyword should appear in only ONE experience bullet (if at all) - avoid repetition
   - Frame as implementation/integration work, not deep specialization
   - Example: "Integrated [category] services including [keyword]" NOT "Built [keyword] systems" or "Designed [keyword] framework"
   - If a keyword is too far from existing experience, add it only to skills section, not experience bullets

3. INTELLIGENT RESTRUCTURING (Make it BETTER while MAINTAINING OWNERSHIP):
   - Rephrase bullets to better align with the role's primary focus FROM THE JOB DESCRIPTION
   - Prioritize relevant experience and skills that match the job requirements
   - Improve clarity and flow - the resume should read naturally
   - MAINTAIN or STRENGTHEN ownership language - never weaken it
   - Use role-appropriate language (${rules.verbs.join(', ')}) BUT only if it doesn't downgrade existing strong verbs
   - When rephrasing: Enhance the sentence without reducing authority and without adding new technologies
   - Example GOOD (Rephrasing): "Built APIs" → "Built scalable RESTful APIs" (if APIs were already there)
   - Example BAD (Adding): "Built APIs" → "Built APIs using MongoDB" (if MongoDB wasn't in original resume)
   - REMEMBER: You REPHRASE existing content, you do NOT ADD new technologies or tools
   - ${roleLevel === 'intern' ? 'For intern roles: Only use exploratory language if original resume already uses it' : roleLevel === 'junior' ? 'For junior roles: Maintain practical implementation language, avoid downgrading' : roleLevel === 'senior' || roleLevel === 'staff' ? 'For senior roles: Maintain or strengthen leadership/architecture language' : 'For mid-level roles: Maintain ownership and implementation language'}

5. TERMINOLOGY & EXAMPLES:
   - Use EXACT terminology from missing keywords when possible
   - For technology/tool keywords: Add to skills section (required), only add to bullets if work actually involved it
   - For concept/methodology keywords: Add to skills section, summary if core requirement, and ONE bullet where it makes sense
   - Example GOOD: "Built APIs supporting retrieval-augmented generation (RAG) patterns" - shows HOW keyword was used
   - Example BAD: Adding 5+ advanced concepts to one bullet - sounds fabricated
   - Example BAD: Repeating same keyword in multiple bullets - keyword stuffing

6. FINAL QUALITY CHECKS:
   - NATURALNESS CHECK: Does the resume sound like a human wrote it, or obvious AI keyword stuffing?
   - LANGUAGE CHECK: Are added keywords framed as integration/implementation work, not deep specialization?
   - VERB PROTECTION CHECK: Ensure no action verbs were downgraded (Led→Participated, Built→Assisted, etc.)
   - Review all bullets for role-appropriate language (${rules.verbs.join(', ')}) WITHOUT downgrading existing strong verbs
   - Each keyword should appear in only ONE bullet maximum (avoid repetition)
   - If a bullet mentions 2+ new advanced concepts, simplify to 1 keyword per bullet
   - Ask: "Could this person defend this in an interview?" - maintain believability
   - OWNERSHIP CHECK: The resume should show the same or stronger ownership than the original
   - INTEGRATION LANGUAGE CHECK: Are added keywords using soft phrases like "integrated", "worked with", "implemented using", "leveraged", "utilized"?
   - The regenerated resume should be BETTER - more natural, credible, and role-aligned
   - REMEMBER: Naturalness and believability are more important than 100% keyword coverage. It's better to achieve 95% match with natural language than 100% with obvious stuffing.

${jobKeywords.length > 0 ? `\nKEYWORDS FROM JOB DESCRIPTION:\n${jobKeywords.slice(0, 50).join(', ')}\n` : ''}

Your task: Return a STRUCTURED JSON object with the regenerated resume data and cover letter. Use this EXACT format (no markdown, just valid JSON):

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
  "summary": "Professional summary paragraph (intelligently integrate missing keywords naturally while improving alignment with role)",
  "education": [
    {
      "degree": "Degree name",
      "school": "School name",
      "location": "Location if present",
      "year": "Graduation year or date"
    }
  ],
  "skills": {
    "languages": ["Language 1", "Language 2", "ADD MISSING KEYWORDS HERE"],
    "frameworks": ["Framework 1", "Framework 2", "ADD MISSING KEYWORDS HERE"],
    "devops": ["Tool 1", "Tool 2", "ADD MISSING KEYWORDS HERE"],
    "databases": ["Database 1", "Database 2", "ADD MISSING KEYWORDS HERE"],
    "other": ["Skill 1", "Skill 2", "ADD MISSING KEYWORDS HERE"]
  },
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "Location if present",
      "period": "Start date – End date or Present",
      "bullets": [
        "REFRAME existing bullet point 1 to naturally demonstrate missing keywords through actual work",
        "REFRAME existing bullet point 2 to naturally demonstrate missing keywords through actual work",
        "REFRAME existing bullet point 3 to naturally demonstrate missing keywords through actual work"
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

MANDATORY REQUIREMENTS FOR FLEXIBLE MODE:
- Extract ALL information from the CURRENT RESUME CONTENT above - nothing should be missing
- PRESERVE 100% of all existing sections, experience, skills, education, projects
- INTELLIGENTLY ADD missing keywords with plausibility guardrails - frame as integration/implementation work, not deep specialization
- CRITICAL: MAINTAIN or STRENGTHEN ownership language - NEVER downgrade action verbs (Led→Participated, Built→Assisted, etc.)
- CRITICAL: Use soft integration language for added keywords: "integrated", "worked with", "implemented using APIs", "leveraged services" - NOT "architected", "designed from scratch", "built core systems"
- For skills section: Keep ALL existing skills AND ADD missing technology/tool keywords (adjacent technologies are safe to add)
- For experience bullets: ENHANCE bullets to include missing keywords using integration-level language - maximum 1 keyword per bullet
- For summary: Keep existing summary AND ADD 3-5 most important missing keywords naturally with soft integration language
- CREDIBILITY CHECK: Added keywords should feel like natural career positioning, not fabrication. Use integration language, not deep-expert claims
- KEYWORD DENSITY: Maximum 1 new keyword per experience bullet - don't cram multiple advanced concepts into one bullet
- DISTRIBUTE keywords across bullets: Spread keywords across different experience bullets (1 keyword per bullet max) rather than stuffing them all into one
- NO REPETITION: Each keyword should appear in only ONE experience bullet (if at all) - don't repeat the same keyword across multiple bullets
- NATURALNESS CHECK: The resume must sound like a human career strategist positioned the candidate, not an AI keyword stuffer
- If a section doesn't exist in the original resume, use an empty array or omit the field
- Keep the structure consistent and complete
- The coverLetter field is MANDATORY - always include it
- FINAL VERIFICATION: 
  * NATURALNESS CHECK: Does the resume sound human-written or obvious AI keyword stuffing?
  * LANGUAGE CHECK: Are added keywords using soft integration language ("integrated", "worked with", "implemented using", "leveraged", "utilized")?
  * KEYWORD VERIFICATION: Added keywords should be adjacent to existing experience, not completely unrelated
  * OWNERSHIP VERIFICATION: Compare regenerated resume to original - ensure no action verbs were downgraded
  * INTEGRATION LEVEL CHECK: Are added keywords framed as implementation/integration work, not deep specialization?
  * If a keyword is too far from existing experience, it's acceptable to add it only to skills section or omit it - naturalness is more important than 100% match`;
    } else {
      // Analyze job context for role-aware regeneration
      const roleContext = this.analyzeJobContext(jobDescription, roleLevel);
      
      return `You are a professional resume editor in STRICT MODE. Your job is to improve alignment between the resume and job description through rephrasing and reorganization ONLY - you may NOT add new content.

🚨 STRICT MODE - CRITICAL RULES (MODE LOCK ACTIVE):

You are in STRICT MODE. This means you MUST preserve factual accuracy above all else. You may ONLY work with what is already in the resume.

🎯 PRIMARY OBJECTIVES (IN ORDER OF PRIORITY):
1. MAINTAIN 100% FACTUAL ACCURACY - The resume is the ONLY source of truth
2. Rephrase and reorganize existing content to better align with job description
3. Improve ATS alignment while preserving confident, ownership-driven, human tone
4. Make the resume BETTER than the original - improve clarity, flow, and role alignment
5. Preserve all core information (experiences, companies, dates, projects, education)

🚨 FACTUAL ACCURACY IS MORE IMPORTANT THAN KEYWORD MATCH SCORE

🚫 ABSOLUTELY FORBIDDEN IN STRICT MODE:
- Do NOT add any new technologies, tools, frameworks, or software not explicitly in the original resume
- Do NOT add technologies to specific job entries unless they were already tied to that job in the original resume
- Do NOT add new industries, domains, or responsibilities not mentioned in the original resume
- Do NOT add new skills, certifications, or capabilities not present in the original resume
- Do NOT add tools mentioned in job description if they are not in the original resume (e.g., "Figma", "Sketch", "MongoDB" if not already there)
- Do NOT enhance bullets with new technologies or tools - only rephrase what's already there

📋 JOB CONTEXT ANALYSIS (CRITICAL - Use this to guide your regeneration):
${roleContext}

🚨 MISSING KEYWORDS TO INTEGRATE (ONLY if they map to existing resume content):
${missingKeywordsList}

🔑 KEYWORD MAPPING RULE FOR STRICT MODE (CRITICAL - READ CAREFULLY):

You may ONLY rephrase existing content. You may NOT add new keywords that don't already exist in the resume.

✅ VALID REPHRASING EXAMPLES (These are rewordings, not additions):
- Resume has "REST APIs" → Can rephrase as "RESTful API development"
- Resume has "AI integrations" → Can rephrase as "AI-powered features" or "AI integrations"
- Resume has "video features" → Can rephrase as "video call platforms" or "video measurements"
- Resume has "database work" → Can use specific database names ONLY IF they're already listed in the resume skills section

❌ INVALID - DO NOT ADD THESE (Even if job description mentions them):
- Job mentions "Figma" but resume doesn't → DO NOT add "Figma" or "worked with Figma"
- Job mentions "Sketch" but resume doesn't → DO NOT add "Sketch" or "used Sketch"
- Job mentions "MongoDB" but resume doesn't → DO NOT add "leveraging MongoDB" to experience bullets
- Job mentions "React" but resume doesn't show React in that specific job → DO NOT add "using React" to that job entry
- Job mentions "computer vision" but resume doesn't → DO NOT add "computer vision"
- Job mentions "Firebase" but resume doesn't → DO NOT add "Firebase"
- Job mentions "translation" but resume doesn't → DO NOT add "translation features"
- Job mentions "Supabase" but resume doesn't → DO NOT add "Supabase"

🎯 KEY PRINCIPLE:
If a keyword from the job description is not already present in the resume (either explicitly or as a clear synonym), you MUST omit it. Do NOT add it to skills section, summary, or experience bullets. It's better to have lower keyword match than to invent experience.

⚠️ DOMAIN-AGNOSTIC FILTERING: Ignore any non-skill keywords like dates, locations, company names, application instructions, or posting metadata. Only treat as missing if they are actual required skills/tools/qualifications. This app works for ALL job types (software, healthcare, finance, marketing, etc.) - use semantic understanding to distinguish real skills from job posting boilerplate.

⚠️ IF A KEYWORD CANNOT BE MAPPED TO EXISTING RESUME CONTENT, OMIT IT. DO NOT INVENT OR ASSUME.

VERIFICATION CHECKLIST (Only add keywords that map to existing resume content):
${filteredMissingKeywords.map((kw, idx) => `[ ] "${kw}" - Only add if it maps to existing resume content, otherwise OMIT`).join('\n')}

${matchedKeywords.length > 0 ? `\n✅ MATCHED KEYWORDS (Already present - maintain these naturally):
${matchedKeywords.map((kw, idx) => `${idx + 1}. "${kw}"`).join('\n')}

These keywords are already well-matched. Ensure they remain naturally integrated in the regenerated resume.\n` : ''}

JOB DESCRIPTION (READ CAREFULLY - This defines what the role needs):
${jobDescription}

CURRENT RESUME CONTENT (Use this as your foundation):
${resumeText}

🚨 CRITICAL LANGUAGE PROTECTION RULES (NEVER VIOLATE THESE):

1. VERB PROTECTION - DO NOT DOWNGRADE OWNERSHIP:
   ❌ FORBIDDEN DOWNGRADES (Never do these):
   - "Led" → "Helped/Participated/Assisted"
   - "Built" → "Worked on/Contributed to"
   - "Implemented" → "Assisted with/Supported"
   - "Architected" → "Supported/Helped design"
   - "Owned" → "Worked on/Contributed to"
   - "Designed" → "Assisted with design"
   
   ✅ CORRECT APPROACH:
   - If a bullet says "Led development", keep it as "Led" or strengthen to "Led and architected"
   - If a bullet says "Built APIs", keep it as "Built" or enhance to "Built and optimized"
   - If a bullet says "Implemented features", keep it as "Implemented" or enhance to "Implemented and scaled"
   - ONLY use weaker verbs (contributed, assisted, participated) if the role is explicitly intern/junior AND the original resume already used those verbs
   - For contract/startup roles: MAINTAIN or STRENGTHEN ownership language

2. OWNERSHIP & IMPACT PRESERVATION:
   - Maintain strong action verbs that show ownership and results
   - Preserve impact language (numbers, metrics, outcomes)
   - Keep confident, professional tone
   - Do NOT add filler phrases like "gained experience in" or "exposure to" unless the role is explicitly an internship

🎯 INTELLIGENT REGENERATION STRATEGY (STRICT MODE):

1. CORE INFORMATION PRESERVATION:
   - Preserve all experiences, companies, dates, projects, education, and contact information
   - Maintain the overall structure and sections
   - Keep all matched keywords naturally integrated: ${matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'N/A'}

2. REPHRASING EXISTING CONTENT (STRICT MODE - NO ADDITIONS):
   - Skills Section: DO NOT add new keywords. Only rephrase existing skills to match job terminology
   - Summary: Rephrase existing summary to better align with job description - DO NOT add new keywords that aren't in the resume
   - Experience Bullets: Rephrase existing bullets to better align with job description - DO NOT add new technologies, tools, or capabilities
   - CRITICAL: You may ONLY rephrase what's already there. You may NOT add new technologies to job entries (e.g., don't add "React" to a job entry if it wasn't already there)
   - CRITICAL: You may NOT add tools mentioned in job description if they're not in the original resume (e.g., "Figma", "Sketch", "MongoDB" usage claims)
   - If a keyword from job description doesn't exist in the resume, OMIT it completely - do not add it anywhere

3. INTELLIGENT REPHRASING (Make it BETTER while MAINTAINING OWNERSHIP):
   - Rephrase bullets to better align with the role's primary focus FROM THE JOB DESCRIPTION
   - Improve clarity and flow - the resume should read naturally
   - MAINTAIN or STRENGTHEN ownership language - never weaken it
   - Use role-appropriate language (${rules.verbs.join(', ')}) BUT only if it doesn't downgrade existing strong verbs
   - When rephrasing: Enhance the sentence without reducing authority and without adding new technologies
   - Example GOOD (Rephrasing): "Built APIs" → "Built scalable RESTful APIs" (if APIs were already there)
   - Example BAD (Adding): "Built APIs" → "Built APIs using MongoDB" (if MongoDB wasn't in original resume)
   - REMEMBER: You REPHRASE existing content, you do NOT ADD new technologies or tools
   - ${roleLevel === 'intern' ? 'For intern roles: Only use exploratory language if original resume already uses it' : roleLevel === 'junior' ? 'For junior roles: Maintain practical implementation language, avoid downgrading' : roleLevel === 'senior' || roleLevel === 'staff' ? 'For senior roles: Maintain or strengthen leadership/architecture language' : 'For mid-level roles: Maintain ownership and implementation language'}
4. TERMINOLOGY & REPHRASING (STRICT MODE):
   - Rephrase existing content to use terminology from job description IF it matches existing resume content
   - For technology/tool keywords: DO NOT add to skills section if not already there. Only rephrase existing skills.
   - For concept/methodology keywords: DO NOT add if not in original resume. Only rephrase existing content.
   - Example GOOD (Rephrasing): "Built APIs" → "Developed RESTful APIs" (if APIs were already mentioned)
   - Example BAD (Adding): "Built APIs" → "Built APIs using MongoDB" (if MongoDB wasn't in original resume)
   - Example BAD (Adding): Adding "Figma" or "Sketch" to experience bullets if not in original resume
   - REMEMBER: In strict mode, you REPHRASE, you do NOT ADD

5. FINAL QUALITY CHECKS FOR STRICT MODE:
   - FACTUAL ACCURACY CHECK: Compare regenerated resume to original - ensure NO new technologies, tools, frameworks, or skills were added
   - TECHNOLOGY CHECK: Ensure no technologies were added to specific job entries that weren't already tied to those jobs in the original resume
   - TOOLS CHECK: Ensure no tools mentioned in job description were added if they weren't in the original resume (e.g., Figma, Sketch, MongoDB usage claims)
   - KEYWORD VERIFICATION: If a keyword from job description doesn't exist in original resume, it should be OMITTED, not added
   - VERB PROTECTION CHECK: Ensure no action verbs were downgraded (Led→Participated, Built→Assisted, etc.)
   - Review all bullets for role-appropriate language (${rules.verbs.join(', ')}) WITHOUT downgrading existing strong verbs
   - Ask: "Could this person defend this in an interview?" - maintain believability
   - OWNERSHIP CHECK: The resume should show the same or stronger ownership than the original
   - The regenerated resume should be BETTER - more natural, credible, and role-aligned through REPHRASING, not adding
   - REMEMBER: In strict mode, you REPHRASE existing content. You do NOT ADD new technologies, tools, or capabilities. Accuracy is more important than keyword match score.

${jobKeywords.length > 0 ? `\nKEYWORDS FROM JOB DESCRIPTION:\n${jobKeywords.slice(0, 50).join(', ')}\n` : ''}

Your task: Return a STRUCTURED JSON object with the regenerated resume data and cover letter. Use this EXACT format (no markdown, just valid JSON):

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
  "summary": "Professional summary paragraph (intelligently rephrase to integrate missing keywords naturally while improving alignment)",
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
  CRITICAL: In "other" skills, ONLY include actual skills/competencies/methodologies/tools from original resume. Use semantic understanding: if a word/phrase is a date, location, job board element, generic filler, or wouldn't belong on ANY resume skills section, DO NOT include it. This applies to ALL job types (not just technical roles).
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "Location if present",
      "period": "Start date – End date or Present",
      "bullets": [
        "REFRAME existing bullet point 1 to naturally demonstrate missing keywords through actual work",
        "REFRAME existing bullet point 2 to naturally demonstrate missing keywords through actual work",
        "REFRAME existing bullet point 3 to naturally demonstrate missing keywords through actual work"
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

MANDATORY REQUIREMENTS:
- Extract ALL information from the CURRENT RESUME CONTENT above - nothing should be missing
- PRESERVE 100% of all existing sections, experience, skills, education, projects
- Rephrase existing content to include ALL missing keywords from the list above
- For skills section: Keep ALL existing skills AND rephrase to include missing keywords
- For experience bullets: REFRAME existing bullets STRATEGICALLY - add maximum 1 missing keyword per bullet where it makes strong contextual sense, not all keywords in every bullet
- For summary: Keep existing summary AND rephrase to include 3-5 most important missing keywords naturally with context
- CREDIBILITY CHECK: Every keyword in skills/experience should feel supported by actual work described in bullets - if you add a concept keyword, at least one bullet should show related work
- KEYWORD DENSITY: Maximum 1 new keyword per experience bullet - don't cram multiple advanced concepts into one bullet (e.g., don't add "multi-agent systems", "subagent architecture", "vector databases", and "safety guardrails" all to the same bullet - this sounds fabricated)
- DISTRIBUTE keywords across bullets: Spread keywords across different experience bullets (1 keyword per bullet max) rather than stuffing them all into one
- NO REPETITION: Each keyword should appear in only ONE experience bullet (if at all) - don't repeat the same keyword across multiple bullets (e.g., don't add "vector databases" to bullet 1, then also add "vector databases" to bullet 2 and bullet 3)
- If a section doesn't exist in the original resume, use an empty array or omit the field
- Keep the structure consistent and complete
- The coverLetter field is MANDATORY - always include it
- FINAL VERIFICATION: After generating, verify that EVERY keyword from the missing keywords list appears in the resume (skills/summary/bullets) AND feels naturally integrated, not forced
- BELIEVABILITY CHECK: Review each experience bullet - if it mentions 2+ new advanced AI/technical concepts, it's probably too much - simplify to 1 keyword per bullet max
- INTERVIEW SAFETY: Ensure the person could realistically answer questions about any advanced concepts mentioned in bullets`;
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
   * Detect role seniority level from job description (domain-agnostic)
   * Returns: 'intern' | 'junior' | 'mid' | 'senior' | 'staff'
   */
  private detectRoleLevel(jobDescription: string): 'intern' | 'junior' | 'mid' | 'senior' | 'staff' {
    const jdLower = jobDescription.toLowerCase();
    
    // Intern indicators (domain-agnostic)
    const internPatterns = [
      /\bintern\b/i,
      /\binternship\b/i,
      /\bstudent\b/i,
      /\blearning\b/i,
      /\bmentorship\b/i,
      /\bentry\s+level\b/i,
      /\bentry-level\b/i,
      /\bexposure\b/i,
      /\bexplore\b/i,
      /\bassist\b/i,
      /\bsupport\b/i,
    ];
    
    // Junior/Entry indicators
    const juniorPatterns = [
      /\b(0|zero|no)\s*(to\s*)?[12]\s*years?\b/i,
      /\bjunior\b/i,
      /\bassociate\b/i,
      /\bentry\b/i,
      /\bassist\b/i,
      /\bsupport\b/i,
    ];
    
    // Senior indicators
    const seniorPatterns = [
      /\b(5|6|7|8|9|10)\+?\s*years?\b/i,
      /\bsenior\b/i,
      /\blead\b/i,
      /\barchitect\b/i,
      /\bmentor\b/i,
      /\bdesign\s+systems\b/i,
      /\bstrategic\b/i,
    ];
    
    // Staff/Principal indicators
    const staffPatterns = [
      /\b(10|11|12|15)\+?\s*years?\b/i,
      /\bstaff\b/i,
      /\bprincipal\b/i,
      /\bdistinguished\b/i,
      /\borg-level\b/i,
      /\bcross-team\s+architecture\b/i,
      /\btechnical\s+strategy\b/i,
    ];
    
    // Mid-level indicators
    const midPatterns = [
      /\b(3|4|5)\s*(to\s*)?(4|5|6|7)\s*years?\b/i,
      /\bmid-level\b/i,
      /\bmid\s+level\b/i,
      /\bown\s+features\b/i,
      /\bindependent\b/i,
      /\bcollaborate\s+cross-functionally\b/i,
    ];
    
    // Check in order of specificity (most specific first)
    if (internPatterns.some(pattern => pattern.test(jdLower))) {
      return 'intern';
    }
    
    if (staffPatterns.some(pattern => pattern.test(jdLower))) {
      return 'staff';
    }
    
    if (seniorPatterns.some(pattern => pattern.test(jdLower))) {
      return 'senior';
    }
    
    if (midPatterns.some(pattern => pattern.test(jdLower))) {
      return 'mid';
    }
    
    if (juniorPatterns.some(pattern => pattern.test(jdLower))) {
      return 'junior';
    }
    
    // Default to mid if unclear
    return 'mid';
  }

  /**
   * Get seniority-aware language rules (domain-agnostic)
   */
  private getSeniorityLanguageRules(level: 'intern' | 'junior' | 'mid' | 'senior' | 'staff'): {
    verbs: string[];
    avoidVerbs: string[];
    scope: string;
    leadership: boolean;
    architecture: boolean;
    keywordStrength: 'exploratory' | 'practical' | 'strategic';
  } {
    switch (level) {
      case 'intern':
        return {
          verbs: ['contributed to', 'assisted with', 'worked on', 'supported', 'gained experience with', 'explored', 'learned', 'participated in', 'helped'],
          avoidVerbs: ['architected', 'led', 'designed system architecture', 'owned end-to-end', 'built production-grade'],
          scope: 'feature-level or experimental work',
          leadership: false,
          architecture: false,
          keywordStrength: 'exploratory',
        };
      case 'junior':
        return {
          verbs: ['built', 'implemented', 'developed', 'created', 'collaborated on', 'worked with'],
          avoidVerbs: ['architected', 'led cross-team', 'defined strategy', 'owned roadmap'],
          scope: 'feature-level ownership',
          leadership: false,
          architecture: false,
          keywordStrength: 'practical',
        };
      case 'mid':
        return {
          verbs: ['built', 'implemented', 'developed', 'designed', 'collaborated on', 'contributed to'],
          avoidVerbs: ['led org-level', 'defined company strategy'],
          scope: 'feature to system-level ownership',
          leadership: false,
          architecture: true,
          keywordStrength: 'practical',
        };
      case 'senior':
        return {
          verbs: ['architected', 'led', 'designed', 'owned', 'mentored', 'established'],
          avoidVerbs: [],
          scope: 'system-level ownership',
          leadership: true,
          architecture: true,
          keywordStrength: 'strategic',
        };
      case 'staff':
        return {
          verbs: ['architected', 'led', 'defined', 'established', 'mentored', 'influenced'],
          avoidVerbs: [],
          scope: 'org-level impact',
          leadership: true,
          architecture: true,
          keywordStrength: 'strategic',
        };
      default:
        return {
          verbs: ['built', 'implemented', 'developed'],
          avoidVerbs: [],
          scope: 'feature-level',
          leadership: false,
          architecture: false,
          keywordStrength: 'practical',
        };
    }
  }

  /**
   * Domain-agnostic check if a keyword is likely a skill/tool/concept vs noise
   * Uses regex patterns to identify noise without hardcoding domain-specific terms
   */
  private isLikelySkillKeyword(kw: string): boolean {
    if (!kw || kw.trim().length < 3) return false;
    
    const lower = kw.toLowerCase().trim();
    
    // Domain-agnostic noise patterns (works for all job types)
    const noisePatterns = [
      // Time references
      /\d{1,2}\s*(days?|weeks?|months?|hours?|years?)\s*(ago|old)/i,
      // Job board UI elements
      /(posted|apply|save|share|glance|at a glance|apply by)/i,
      // Location/work arrangement descriptors
      /(remote|onsite|hybrid|us|united states|based in|location|work from home)/i,
      // Visa/authorization terms
      /(authorization|required|open to|candidates|opt|cpt|visa|sponsorship)/i,
      // Salary/compensation patterns
      /\d{1,3}(,\d{3})*(\s*\$|\s*USD|\/hr|\/hour|paid)/i,
      // Generic intro/greeting fluff
      /^(hi|hello|👋|thanks|thank you)$/i,
      // Pure numbers or dates
      /^\d+$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
      // Very short generic words
      /^(the|a|an|and|or|but|in|on|at|to|for|of|with|by|from|as|is|was|are|were|been|be|have|has|had|do|does|did|will|would|should|could|may|might|must|can|this|that|these|those|i|you|he|she|it|we|they|what|which|who|whom|whose|where|when|why|how|all|each|every|both|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|now)$/i,
      // Job posting meta-text
      /^(looking|seeking|candidate|position|role|opportunity|company|team|work|environment|culture|benefits|compensation|salary|hour|week|year|experience|required|preferred|qualifications|responsibilities|duties|tasks)$/i,
    ];

    // Check against noise patterns
    if (noisePatterns.some(pattern => pattern.test(lower))) {
      return false;
    }

    // Likely skill indicators (domain-agnostic heuristics)
    // Multi-word phrases are often skills/concepts (e.g., "project management", "data analysis", "patient care")
    // This works across all domains without hardcoding specific terms

    // Multi-word phrases (likely skills/concepts)
    if (lower.includes(' ') && lower.split(' ').length <= 4 && lower.length >= 5) {
      return true;
    }

    // Acronyms (likely technologies/tools)
    if (/^[A-Z]{2,}(?:\/[A-Z]{2,})*$/.test(kw) && kw.length >= 2) {
      return true;
    }

    // Contains numbers but also letters (likely version numbers or tech terms)
    if (/\d/.test(kw) && /[a-z]/i.test(kw) && kw.length >= 4) {
      return true;
    }

    // Default: if it's not clearly noise and has reasonable length, consider it
    return kw.length >= 4;
  }

  /**
   * Extract important keywords from job description
   * Improved with domain-agnostic filtering
   */
  private extractImportantKeywords(jobDescription: string): string[] {
    // Basic stop words (common English words that are never keywords)
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
    ]);

    // Domain-agnostic noise filtering - only universal job board elements
    // No domain-specific terms to keep it general-purpose
    const obviousNoise = new Set([
      // Job board UI elements (universal across all job sites)
      'posted', 'apply', 'save', 'share', 'days', 'ago', 'weeks', 'months', 'glance',
      // Very common generic fillers that appear in all job postings
      'looking', 'seeking', 'candidate', 'required', 'preferred', 'open', 'close'
    ]);

    const keywordSet = new Set<string>();

    // First, extract acronyms and technical compound terms (before normalizing)
    // Look for patterns like: "LLMs", "RAG", "CI/CD", "AWS", etc.
    const acronymPattern = /\b[A-Z]{2,}(?:\/[A-Z]{2,})*\b/g;
    const acronyms = jobDescription.match(acronymPattern) || [];
    acronyms.forEach(acronym => {
      const clean = acronym.trim();
      // Use domain-agnostic filtering for acronyms
      if (this.isLikelySkillKeyword(clean)) {
        keywordSet.add(clean); // Keep acronyms in uppercase
      }
    });

    // Extract multi-word technical terms and compound phrases
    // Look for patterns like: "evaluation framework", "testing framework", "quality metrics", etc.
    // This is domain-agnostic and will catch any multi-word technical terms
    const compoundTermPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    const compoundTerms = jobDescription.match(compoundTermPattern) || [];
    compoundTerms.forEach(term => {
      const clean = term.trim();
      // Use domain-agnostic filtering
      if (this.isLikelySkillKeyword(clean)) {
        keywordSet.add(clean);
      }
    });

    // Now extract individual words
    const normalized = jobDescription
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');

    const words = normalized
      .split(' ')
      .filter(word => {
        // Must be at least 3 characters (or 2 for acronyms, but we handle those above)
        if (word.length < 3) return false;
        // Not a stop word
        if (stopWords.has(word)) return false;
        // Not obvious job board UI noise
        if (obviousNoise.has(word)) return false;
        // Not just numbers
        if (/^\d+$/.test(word)) return false;
        return true;
      });

    // Add individual words, but filter using domain-agnostic check
    words.forEach(word => {
      if (this.isLikelySkillKeyword(word)) {
        keywordSet.add(word);
      }
    });

    // Also extract capitalized technical terms (technologies, tools, frameworks)
    const capitalizedTerms = jobDescription.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    capitalizedTerms.forEach(term => {
      const clean = term.trim();
      // Use domain-agnostic filtering
      if (this.isLikelySkillKeyword(clean)) {
        keywordSet.add(clean);
      }
    });

    return Array.from(keywordSet).slice(0, 150); // Increased limit to capture more keywords
  }

  private buildTailoringPrompt(
    resumeText: string,
    jobDescription: string,
    generateFreely: boolean,
    jobKeywords: string[] = [],
    roleLevel: 'intern' | 'junior' | 'mid' | 'senior' | 'staff' = 'mid',
    seniorityRules?: { verbs: string[]; avoidVerbs: string[]; scope: string; leadership: boolean; architecture: boolean; keywordStrength: 'exploratory' | 'practical' | 'strategic' }
  ): string {
    const rules = seniorityRules || this.getSeniorityLanguageRules(roleLevel);
    if (generateFreely) {
      return `You are helping a job seeker tailor their resume to a specific job description and generate a professional cover letter.

⚠️ DOMAIN-AGNOSTIC INSTRUCTION: This app works for ALL job types (software engineering, healthcare, finance, marketing, sales, operations, etc.). Ignore any non-skill keywords like dates, locations, company names, application instructions, or posting metadata. Only treat as important if they are actual required skills/tools/qualifications. Use semantic understanding to distinguish real skills from job posting boilerplate.

CRITICAL RULES FOR FLEXIBLE MODE (100% MATCH MODE - TARGET 100% KEYWORD INCLUSION):
1. YOUR PRIMARY GOAL: Achieve 100% keyword match - include EVERY high-impact keyword from the job description. NO EXCEPTIONS. The resume MUST include ALL skills, tools, technologies, and methodologies mentioned in the job description. This is MANDATORY for ATS optimization.
2. AGGRESSIVE SEMANTIC MATCHING STRATEGY:
   - Include high-impact keywords: skills, tools, technologies, certifications, methodologies
   - Use semantic synonyms: "hardware engineering" = "electronic design", "cloud computing" = "AWS/Azure/GCP"
   - Match concepts, not just words: "team leadership" matches "managed team" or "led team"
   - IGNORE noise: filler words, dates, locations, job board boilerplate ("posted", "apply", "weeks ago")
3. BASE everything on the user's actual resume, but ENHANCE aggressively:
   - If the job requires a skill/tool that's not in the resume, ADD it to the skills section (you can infer the user likely has exposure to it based on their background)
   - If the job requires experience with something not explicitly mentioned, ADD it to relevant experience bullets
   - If the user has similar experience, REFRAME it to match exactly what the job requires
4. MANDATORY KEYWORD INCLUSION STRATEGY (100% REQUIREMENT):
   - Extract EVERY high-impact keyword from the job description (technologies, tools, methodologies, skills, certifications, acronyms)
   - You MUST include EVERY keyword mentioned in the job description - they MUST appear in the resume
   - CRITICAL: Include ALL acronyms EXACTLY as written in job description (preserve exact format, capitalization, and spelling)
   - CRITICAL: Include multi-word technical terms and compound phrases EXACTLY as they appear in the job description
   - Use the EXACT terminology from the job description - ATS systems look for exact matches, especially for acronyms and specific technical terms
   - Include keywords NATURALLY throughout the resume: in summary, skills section, experience bullets, and project descriptions
   - If a keyword is missing from the original resume, ADD it to the skills section (REQUIRED for 100% match). Optionally add to summary and/or ONE experience bullet if it naturally fits.
   - 100% MATCH PRIORITY: Skills section + summary should contain ALL keywords. Experience bullets are optional enhancement - don't force keywords into bullets if they don't fit naturally.
   - CREDIBILITY IS KEY: Keywords in skills should ideally be supported by evidence in experience bullets, but for 100% match mode, skills section coverage is acceptable if bullets don't naturally support them
   - Repeat important keywords 2-3 times throughout the resume for better ATS scoring, but make each mention feel natural and contextual. NO REPETITION in bullets - each keyword appears in only ONE bullet maximum.
   - Create a comprehensive skills section that includes ALL job-required technologies (this is the primary way to achieve 100% match)
   - Pay special attention to compound technical terms and multi-word phrases - extract and include them exactly as written
   - When adding concept/methodology keywords: Add to skills section first, then summary, then optionally ONE experience bullet if it naturally fits. DO NOT add the same keyword to multiple bullets.
5. ZERO TOLERANCE FOR MISSING KEYWORDS:
   - NO keyword should be missing - if you see it in the job description, it MUST be in the tailored resume
   - If the job requires any technology, tool, skill, or methodology and it's not in the resume, ADD it to the appropriate section
   - CRITICAL: Check for acronyms and technical compound terms - these are often the most important for ATS matching
   - Include them EXACTLY as written in the job description (preserve format, capitalization, and spelling)
6. ADD all relevant keywords, skills, tools, and technologies from the job description to the resume - 100% INCLUSION REQUIRED
7. ENHANCE experience bullets to include job-required skills and achievements - REFRAME bullets to naturally demonstrate keywords through actual work, showing HOW they were used, not just mentioning them
8. REORGANIZE and EMPHASIZE sections to highlight qualifications that match the job
9. ALIGN RESUME TONE WITH ROLE TYPE:
   - Analyze the job title and primary responsibilities to understand the role's focus
   - Rephrase experience bullets to match the PRIMARY focus of the role, not just add keywords as afterthoughts
   - The resume should read like it's written FOR this specific role, not a generic resume with keywords added
   - Rephrase the professional summary to emphasize the PRIMARY focus of the role based on the job description
   - Match the tone and emphasis of the job description - if the job emphasizes a specific domain (e.g., AI/ML, data analysis, product management, marketing), align the resume accordingly
10. Use measurable language (numbers, percentages, metrics) - you can add reasonable metrics if they help match the job
11. Match the EXACT language and terminology used in the job description for maximum ATS optimization
12. Keep personal information (name, contact, address) exactly as provided
13. Preserve ALL major sections, experience, and projects from the original resume (but enhance them)
14. CRITICAL: Your resume must pass ATS filters - this means including 100% of high-impact keywords from the job description. ZERO missing keywords allowed.
15. If the job requires specific certifications, software, or methodologies not in the resume, ADD them if they're reasonable for the user's background
16. Create a "Keywords" or "Technologies" section if needed to ensure all important terms are included
17. In the professional summary, include 5-10 key terms from the job description naturally, and ALIGN the summary tone with the role type (e.g., for "AI/ML Intern" role, emphasize AI/ML work, not just "Full-Stack Engineer")
18. BEFORE FINALIZING: Verify that EVERY keyword from the job description appears in the tailored resume. If any are missing, ADD them immediately.
19. ROLE ALIGNMENT CHECK:
   - Read the job title and primary responsibilities
   - If job is "AI/ML Intern", the resume should emphasize AI/ML work, prompt engineering, LLMs, evaluation frameworks
   - If job is "Data Scientist", emphasize data analysis, modeling, statistics
   - If job is "Product Manager", emphasize product strategy, user research, roadmaps
   - Rephrase the professional summary to match the PRIMARY focus of the role
   - Rephrase experience bullets to emphasize work that aligns with the role, not just add keywords
   - The resume should sound like it was written FOR this specific role, not a generic resume with keywords sprinkled in

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

${jobKeywords.length > 0 ? `\n🚨 MANDATORY KEYWORDS - MUST INCLUDE 100% (extracted from job description):\n${jobKeywords.slice(0, 50).join(', ')}\n\n⚠️ CRITICAL: You MUST include EVERY keyword listed above in the tailored resume. NO EXCEPTIONS.\n- If a keyword is not in the original resume, ADD it to the skills section\n- If a keyword is related to experience, ADD it to relevant experience bullets\n- Use the EXACT terminology from the job description\n- These keywords are MANDATORY for 100% ATS match - missing even one will result in a failed match score` : ''}

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
  CRITICAL: In "other" skills, ONLY include actual skills/competencies/methodologies/tools from original resume. Use semantic understanding: if a word/phrase is a date, location, job board element, generic filler, or wouldn't belong on ANY resume skills section, DO NOT include it. This applies to ALL job types (not just technical roles).
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

MANDATORY REQUIREMENTS FOR FLEXIBLE MODE (100% KEYWORD INCLUSION):
- Include ALL information from the original resume PLUS add ANY missing skills/experiences required by the job
- If a section doesn't exist in the original resume, create it if the job requires it
- For skills, organize them into the provided categories AND ADD EVERY job-required skill that is missing
- For experience, include ALL positions with ALL bullet points ENHANCED to match the job requirements
- CREDIBILITY IS CRITICAL: When adding keywords to skills, REFRAME at least one experience bullet to naturally demonstrate that keyword through actual work
- Example: If adding "RAG" to skills, reframe a bullet about ML/API work to show "Built APIs incorporating retrieval-augmented generation (RAG) patterns for intelligent response systems"
- Make keywords feel AUTHENTIC and SUPPORTED - recruiters should see evidence in bullets, not just keyword lists
- ADD new bullet points or skills if needed to meet 100% of job requirements - NO KEYWORD LEFT BEHIND
- If the job mentions any technology/tool/concept, it MUST appear in the resume AND be supported by evidence in experience bullets where applicable
- Keep the structure consistent and complete
- Your goal is to achieve 100% keyword match - every high-impact keyword from the job description must be present AND feel naturally integrated
- BEFORE FINALIZING: Verify that EVERY keyword from the job description appears in the tailored resume AND feels credible, not forced`;
    } else {
      return `You are helping a job seeker tailor their resume to a specific job description and generate a professional cover letter.

⚠️ DOMAIN-AGNOSTIC INSTRUCTION: This app works for ALL job types (software engineering, healthcare, finance, marketing, sales, operations, etc.). Ignore any non-skill keywords like dates, locations, company names, application instructions, or posting metadata. Only treat as important if they are actual required skills/tools/qualifications. Use semantic understanding to distinguish real skills from job posting boilerplate.

CRITICAL RULES FOR STRICT MODE (LIGHT TAILORING MODE - CONSERVATIVE):
1. ONLY use information from the provided resume - do not invent or add any experience, skills, achievements, education, or personal details that are not present
2. LIGHT TAILORING: Rephrase and emphasize existing content to align with the job description - make subtle adjustments, not major changes
3. Use measurable language (numbers, percentages, metrics) where available in the original resume
4. Match the language and terminology used in the job description - but ONLY for keywords that already exist in the original resume (or are clear synonyms)
5. Focus on ATS (Applicant Tracking System) optimization by using keywords from the job description that match existing resume content - this is about alignment, not addition
6. CONSERVATIVE APPROACH: This mode is for light tailoring only - preserve the original resume's tone and content, just make it more aligned with the job description
7. NATURAL REFRAMING FOR CREDIBILITY:
   - REFRAME experience bullets to naturally demonstrate keywords through actual work described
   - Example: If resume has "built ML features" and job wants "RAG", reframe as "Built ML features incorporating retrieval-augmented generation patterns" if the work actually involved retrieval patterns
   - Make keywords feel AUTHENTIC and SUPPORTED by actual work - recruiters should see evidence, not just keyword mentions
   - Use natural, professional language - keywords should flow naturally in sentences
7. Keep personal information (name, contact, address) exactly as provided
8. Preserve ALL sections, skills, experience, and projects - nothing should be missing
9. DO NOT add new skills, experiences, or qualifications that are not in the original resume
10. DO NOT enhance or expand beyond what is explicitly stated in the resume
11. Your job is to rephrase and reorganize to naturally demonstrate existing keywords, not to add new content
11. CRITICAL: IDENTIFY AND IGNORE NOISE WORDS - Use your intelligence to distinguish meaningful keywords from noise:
    MEANINGFUL KEYWORDS (include if in original resume):
    - Skills, competencies, abilities (e.g., "project management", "data analysis", "customer service", "Python", "Salesforce")
    - Tools, software, platforms (e.g., "Excel", "Tableau", "AWS", "Figma", "SAP")
    - Methodologies, frameworks, processes (e.g., "Agile", "Six Sigma", "Lean", "Scrum")
    - Certifications, licenses (e.g., "CPA", "PMP", "RN", "AWS Certified")
    - Industry-specific terms that represent actual skills (e.g., "financial modeling", "clinical trials", "SEO optimization")
    - Technologies, languages, systems relevant to the role
    
    NOISE WORDS (NEVER add to resume - ignore these):
    - Job board UI elements: "posted", "apply", "save", "share", "days ago", "weeks ago", "intern posted"
    - Dates and time references: month names (january, february, etc.), "week", "weeks", "ago", "hours", "part-time", "full-time"
    - Location descriptors: "united states", "work from home", "remote", "onsite", "hybrid", "based in"
    - Generic business words that aren't skills: "company", "team", "role", "position", "job", "business", "industry" (unless part of a skill like "industry analysis")
    - Common filler words: "the", "this", "that", "what", "which", "who", "you", "your", "our", "we", "they"
    - Job posting meta-text: "looking for", "seeking", "candidate", "required", "preferred", "open", "close", "new", "old"
    - People's names or titles mentioned in job description: any person's name, "founder", "coo", "ceo" (unless it's YOUR title)
    - Action verbs without context: "help", "build", "make", "directly" (unless part of a skill phrase)
    - Single generic words: "app", "application" (unless referring to software like "Salesforce application"), "health", "care", "inc"
    - Phrases that are clearly job description boilerplate, not skills: "the role this", "what you", "this position", "our team"
    
    RULE OF THUMB: If a word/phrase could appear on ANY job posting regardless of role, it's likely noise. If it's specific to the role's requirements and represents a skill/competency, it's meaningful.
12. In the "other" skills section, ONLY include actual skills, competencies, methodologies, tools, or certifications from the original resume. Ask yourself: "Would this word/phrase make sense on a resume skills section for this role?" If it's a date, location, job board element, or generic filler word, DO NOT include it.
13. When rephrasing, use the EXACT terminology from job description ONLY if that terminology already exists in the original resume (or is a clear synonym of existing content)

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

${jobKeywords.length > 0 ? `\n📋 RELEVANT KEYWORDS FROM JOB DESCRIPTION (ONLY USE IF THEY EXIST IN ORIGINAL RESUME):\n${jobKeywords.slice(0, 50).join(', ')}\n\n⚠️ IMPORTANT FOR STRICT MODE:\n- ONLY use keywords that already exist in the original resume\n- Rephrase existing content to match these keywords where applicable\n- DO NOT add keywords that are not in the original resume\n- Use semantic intelligence to IGNORE noise words: dates, locations, job board UI elements, generic filler words, people's names, action verbs without context\n- Focus on meaningful skills, tools, methodologies, certifications, and competencies that match existing resume content\n- Remember: This works for ALL job types - use your understanding of what belongs on a resume vs what is job posting boilerplate` : ''}

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
  CRITICAL: In "other" skills, ONLY include actual skills/competencies/methodologies/tools from original resume. Use semantic understanding: if a word/phrase is a date, location, job board element, generic filler, or wouldn't belong on ANY resume skills section, DO NOT include it. This applies to ALL job types (not just technical roles).
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "Location if present",
      "period": "Start date – End date or Present",
      "bullets": [
        "REFRAMED bullet point 1 to naturally demonstrate job-relevant keywords through actual work",
        "REFRAMED bullet point 2 to naturally demonstrate job-relevant keywords through actual work",
        "REFRAMED bullet point 3 to naturally demonstrate job-relevant keywords through actual work"
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
- CRITICAL FOR "other" SKILLS: Use your intelligence to determine if a word/phrase is a meaningful skill vs noise:
  * MEANINGFUL: Skills, tools, methodologies, certifications, competencies that belong on a resume (e.g., "Project Management", "Data Analysis", "Agile", "Salesforce", "CPA", "Financial Modeling")
  * NOISE: Dates, locations, job board UI elements, generic filler words, people's names, action verbs without context, single generic words that could appear in any job posting
  * Ask yourself: "Would a hiring manager expect to see this in a resume skills section?" If no, it's noise - DO NOT include it.
- For experience, include ALL positions with ALL bullet points REFRAMED to naturally demonstrate job-relevant keywords through actual work
- CREDIBILITY CHECK: When rephrasing bullets, make keywords feel AUTHENTIC and SUPPORTED - show HOW the work relates to the keyword, not just mention it
- Keep the structure consistent and complete
- DO NOT add anything that is not in the original resume
- DO NOT add noise words from job descriptions to any section, especially the skills section
- Remember: This system works for ALL job types (developer, marketer, nurse, accountant, etc.) - use semantic understanding, not hardcoded word lists`;
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
          // Validate that we have essential fields
          const coverLetter = json.coverLetter || '';
          const fullResume = this.generatePlainTextResume(json);
          
          // Log if cover letter is missing
          if (!coverLetter || coverLetter.trim().length === 0) {
            logger.warn('Cover letter is missing from AI response');
          }
          
          // Log if resume is too short (might indicate incomplete generation)
          if (fullResume.length < 100) {
            logger.warn('Generated resume seems too short', { length: fullResume.length });
          }
          
          // Return structured data
          return {
            structured: json,
            coverLetter: coverLetter,
            fullResume: fullResume,
          };
        }
      } catch (e) {
        logger.error('Failed to parse JSON from AI response', { error: e, content_preview: content.substring(0, 200) });
      }
    }

    // Fallback: if JSON parsing fails
    logger.error('Failed to parse structured JSON from AI response, using fallback', { 
      content_length: content.length,
      content_preview: content.substring(0, 500)
    });
    return {
      structured: undefined as any,
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
