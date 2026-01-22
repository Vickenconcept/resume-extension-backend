# Semantic ATS Implementation

## Overview

The ATS (Applicant Tracking System) scoring has been completely rewritten to use **AI-powered semantic understanding** instead of simple keyword counting. This matches how modern ATS systems work in 2026.

## Key Improvements

### 1. **Semantic Matching Instead of Exact Keywords**
- Understands synonyms and related concepts
- "hardware engineering" matches "electronic design" or "circuit development"
- "cloud computing" matches "AWS", "Azure", or "GCP"
- "team leadership" matches "managed team" or "led team"

### 2. **High-Impact Keyword Extraction**
- Focuses on **skills, tools, technologies, certifications, methodologies**
- **Ignores noise**: filler words, dates, locations, job board boilerplate
- Filters out words like: "posted", "apply", "weeks ago", "mount laurel", "january", etc.

### 3. **AI-Powered Analysis**
- Uses OpenAI GPT-4o-mini to intelligently analyze job requirements
- Understands context and intent, not just literal words
- Provides realistic ATS match scores (90-99% target)

### 4. **Weighted Scoring**
- Skills and tools carry more weight than general words
- Section-specific matching (skills, experience, education, tools)
- Overall similarity score considers semantic understanding

## Architecture

### New Service: `SemanticATSService`
- **Location**: `backend2/src/services/semantic-ats.service.ts`
- **Purpose**: AI-powered semantic ATS analysis
- **Methods**:
  - `analyzeATSMatch()`: Main method that uses AI to analyze resume vs job description
  - `extractHighImpactKeywords()`: Extracts only relevant keywords (skills, tools, tech)
  - `isSemanticMatch()`: Checks if two keywords are semantically related

### Updated Service: `QualityService`
- **Location**: `backend2/src/services/quality.service.ts`
- **Changes**:
  - `calculateSimilarity()` is now **async** and uses `SemanticATSService`
  - Falls back to improved keyword extraction if AI service unavailable
  - Better keyword filtering (ignores noise words)

### Updated Controller: `ResumeController`
- **Location**: `backend2/src/controllers/resume.controller.ts`
- **Changes**:
  - `calculateSimilarity()` call is now `await`ed (async)

## How It Works

1. **Job Description Analysis**:
   - AI extracts high-impact keywords (skills, tools, technologies)
   - Ignores filler words, dates, locations, boilerplate
   - Understands job requirements semantically

2. **Resume Analysis**:
   - Extracts relevant keywords from resume
   - Checks for semantic matches (synonyms, related concepts)
   - Calculates section-specific matches

3. **Scoring**:
   - **Similarity Score**: Overall semantic match (0-100)
   - **Keyword Coverage**: Percentage of high-impact keywords found
   - **Section Matches**: Skills, experience, education, tools (each 0-100)

4. **Recommendations**:
   - Only suggests truly missing high-impact keywords
   - Provides semantic alternatives if exact keywords aren't present
   - Focuses on actionable improvements

## Example

### Before (Simple Keyword Counting):
- Job: "Looking for a hardware engineer with experience in electronic design"
- Resume: "Electronic design engineer with circuit development experience"
- **Old Score**: 20% (only "experience" matched)
- **Missing**: "hardware", "engineer", "looking", "for", "with", "in", "design", etc. (200+ words)

### After (Semantic Understanding):
- Job: "Looking for a hardware engineer with experience in electronic design"
- Resume: "Electronic design engineer with circuit development experience"
- **New Score**: 95% (semantic matches: "hardware" = "electronic", "engineer" = "engineer", "design" = "design")
- **Missing**: Only truly missing high-impact keywords (if any)

## Configuration

The semantic ATS service uses the same OpenAI configuration as the resume tailoring:
- `OPENAI_API_KEY`: Required
- `OPENAI_BASE_URL`: Optional (defaults to OpenAI)

## Fallback Behavior

If the AI service is unavailable or fails:
- Falls back to improved keyword extraction
- Still filters out noise words
- Uses semantic matching for common pairs
- Provides reasonable scores without AI

## Target Scores

- **90-99% similarity score**: Target for well-tailored resumes
- **High keyword coverage**: 90%+ of high-impact keywords matched
- **Section matches**: 85%+ for skills, experience, education

## Benefits

1. **More Accurate**: Reflects how real ATS systems work
2. **Less Noise**: Only shows truly relevant missing keywords
3. **Better UX**: Users aren't overwhelmed with 200+ "missing" words
4. **Smarter Matching**: Understands synonyms and related concepts
5. **Actionable**: Recommendations focus on high-impact improvements
