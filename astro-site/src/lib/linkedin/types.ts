// Shared shapes for the LinkedIn Post Generator. The same request/response
// contract is implemented by both providers (the Supabase Edge Function in
// supabase/functions/linkedin-generate and the local mock provider), so the
// UI never needs to know which one produced a result.

import type { Role } from '../supabase';

export type PostLength = 'short' | 'medium' | 'detailed';
export type PostLanguage = 'English' | 'Hindi' | 'Hinglish';

export interface GeneratorInput {
  role: Role;
  /** Assistant: post purpose; student (future): post type. */
  purpose: string;
  topic: string;
  tone: string;
  audience: string;
  language: PostLanguage;
  keywords: string[];
  details: string;
  length: PostLength;
  includeHashtags: boolean;
  includeCta: boolean;
  mentionAcademy: boolean;
}

/** One writing approach the generator is asked to produce. */
export interface Variation {
  key: string;
  title: string;
  brief: string;
}

export interface GeneratedPost {
  key: string;
  title: string;
  content: string;
  hashtags: string[];
  cta: string | null;
  characterCount: number;
}

export interface GenerationResult {
  posts: GeneratedPost[];
  /** Which provider produced this result — the UI labels mock output. */
  source: 'ai' | 'mock';
}

export type GeneratorErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'invalid_response'
  | 'not_configured'
  | 'refused'
  | 'server';

export class GeneratorError extends Error {
  code: GeneratorErrorCode;
  constructor(code: GeneratorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
