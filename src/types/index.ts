export interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  message: string;
  error?: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Resume {
  id: number;
  userId: number;
  resumeId: string;
  filename: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  parsedContent?: any;
  tailoredDocxUrl?: string;
  tailoredPdfUrl?: string;
  tailoredResumeText?: string;
  coverLetter?: string;
  downloadUrls?: {
    docx?: string;
    pdf?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedResumeContent {
  summary?: string;
  experience?: Array<{
    title?: string;
    role?: string;
    company?: string;
    location?: string;
    period?: string;
    bullets?: string[];
  }>;
  skills?: string[];
  achievements?: string[];
  education?: Array<{
    degree?: string;
    school?: string;
    location?: string;
    year?: string;
  }>;
  header?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
  };
  raw_text?: string;
  parsingQuality?: {
    score: number;
    confidence: 'high' | 'medium' | 'low';
    issues: string[];
    warnings: string[];
    isValid: boolean;
  };
}

export interface TailoredResumeData {
  structured?: {
    header?: {
      name?: string;
      title?: string;
      contact?: {
        phone?: string;
        email?: string;
        linkedin?: string;
        github?: string;
        location?: string;
      };
    };
    summary?: string;
    education?: Array<{
      degree?: string;
      school?: string;
      location?: string;
      year?: string;
    }>;
    skills?: {
      languages?: string[];
      frameworks?: string[];
      devops?: string[];
      databases?: string[];
      other?: string[];
    };
    experience?: Array<{
      role?: string;
      company?: string;
      location?: string;
      period?: string;
      bullets?: string[];
    }>;
    projects?: Array<{
      name?: string;
      url?: string;
    }>;
    languages?: Array<{
      language?: string;
      proficiency?: string;
    }>;
    coverLetter?: string;
  };
  coverLetter?: string;
  fullResume?: string;
}

export interface JwtPayload {
  userId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        name: string;
      };
    }
  }
}
