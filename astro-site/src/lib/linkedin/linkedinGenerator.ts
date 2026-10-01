// LinkedIn Post Generator service — the only module the UI calls.
//
// Two interchangeable providers sit behind generateLinkedInPosts():
//   - 'supabase' (real): the `linkedin-generate` Supabase Edge Function,
//     which checks the caller's trusted role and calls the Claude API with
//     a server-side key. No AI credentials ever reach the browser.
//   - 'mock': template drafts from ./mockProvider, for local use before
//     the Edge Function is deployed.
// Choose with PUBLIC_AI_PROVIDER (or the older PUBLIC_LINKEDIN_AI_PROVIDER) in astro-site/.env
// (defaults to 'mock' so the page works out of the box).

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { countCharacters, toLinkedInText } from './format';
import { mockGenerate } from './mockProvider';
import { cleanKeywords, cleanText, type Correction } from './textCleanup';
import { LINKEDIN_CHAR_LIMIT, MAX_DETAILS_LENGTH, MAX_KEYWORDS, MAX_TOPIC_LENGTH, VARIATIONS } from './options';
import { GeneratorError, type GeneratedPost, type GenerationResult, type GeneratorInput, type Variation } from './types';

const PROVIDER: 'supabase' | 'mock' =
  (import.meta.env.PUBLIC_AI_PROVIDER || import.meta.env.PUBLIC_LINKEDIN_AI_PROVIDER) === 'supabase' ? 'supabase' : 'mock';

export const isMockProvider = PROVIDER === 'mock';

export function parseKeywords(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_KEYWORDS);
}

export function validateInput(input: GeneratorInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.topic.trim()) errors.topic = 'Tell us what the post is about.';
  else if (input.topic.trim().length < 10) errors.topic = 'Add a little more detail — at least a short sentence.';
  else if (input.topic.length > MAX_TOPIC_LENGTH) errors.topic = `Keep the topic under ${MAX_TOPIC_LENGTH} characters.`;
  if (!input.purpose) errors.purpose = 'Choose a post purpose.';
  if (!input.tone) errors.tone = 'Choose a tone.';
  if (!input.audience) errors.audience = 'Choose a target audience.';
  if (input.details.length > MAX_DETAILS_LENGTH) errors.details = `Keep additional context under ${MAX_DETAILS_LENGTH} characters.`;
  return errors;
}

/**
 * Full text as it is pasted into LinkedIn: body (with **bold** converted
 * to Unicode bold), then hashtags.
 */
export function composePostText(post: Pick<GeneratedPost, 'content' | 'hashtags'>): string {
  const body = toLinkedInText(post.content);
  return post.hashtags.length ? `${body}\n\n${post.hashtags.join(' ')}` : body;
}

/** Character count as LinkedIn will see the pasted post. */
export function postLength(post: Pick<GeneratedPost, 'content' | 'hashtags'>): number {
  return countCharacters(composePostText(post));
}

/**
 * Fixes spelling, capitalisation and spacing in what the user typed, and
 * reports each correction so the UI can show it. Both providers write
 * from the cleaned input.
 */
export function cleanInput(input: GeneratorInput): { input: GeneratorInput; corrections: Correction[] } {
  const topic = cleanText(input.topic);
  const details = cleanText(input.details);
  const keywords = cleanKeywords(input.keywords);
  const corrections: Correction[] = [];
  for (const c of [...topic.fixes, ...details.fixes, ...keywords.fixes]) {
    if (!corrections.some((x) => x.from.toLowerCase() === c.from.toLowerCase() && x.to === c.to)) corrections.push(c);
  }
  return {
    input: { ...input, topic: topic.text, details: details.text, keywords: keywords.keywords },
    corrections,
  };
}

// Normalises and sanity-checks whatever came back, so a malformed
// response surfaces as a friendly error instead of a broken card.
function normalisePosts(raw: unknown, expected: Variation[]): GeneratedPost[] {
  const list = (raw as { posts?: unknown })?.posts;
  if (!Array.isArray(list) || list.length === 0) {
    throw new GeneratorError('invalid_response', 'The generator returned an unexpected response. Please try again.');
  }
  return list.slice(0, expected.length).map((item: any, i) => {
    const variation = expected.find((v) => v.key === item?.key) ?? expected[i];
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!content) {
      throw new GeneratorError('invalid_response', 'The generator returned an empty post. Please try again.');
    }
    const hashtags: string[] = Array.isArray(item?.hashtags)
      ? item.hashtags
          .filter((h: unknown): h is string => typeof h === 'string' && h.trim().length > 1)
          .map((h: string) => (h.trim().startsWith('#') ? h.trim() : `#${h.trim()}`).replace(/\s+/g, ''))
      : [];
    const post = {
      key: variation.key,
      title: variation.title,
      content,
      hashtags,
      cta: typeof item?.cta === 'string' && item.cta.trim() ? item.cta.trim() : null,
      characterCount: 0,
    };
    post.characterCount = postLength(post);
    return post;
  });
}

async function callEdgeFunction(input: GeneratorInput, variations: Variation[]): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('linkedin-generate', {
    // Only keys are sent — the function holds its own variation briefs.
    body: { input, variations: variations.map((v) => v.key) },
  });
  if (!error) return data;

  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status as number | undefined;
    let serverMessage = '';
    try {
      serverMessage = (await error.context.json())?.error ?? '';
    } catch {
      /* body wasn't JSON — fall through to the status-based message */
    }
    if (status === 401 || status === 403) {
      throw new GeneratorError('unauthorized', 'Your session has expired or you do not have access. Please sign in again.');
    }
    if (status === 429) {
      throw new GeneratorError('rate_limited', serverMessage || 'You have generated a lot of posts in a short time. Please wait a few minutes and try again.');
    }
    if (status === 404) {
      throw new GeneratorError('not_configured', 'The AI writing service is not set up yet. Please contact the site administrator.');
    }
    if (status === 422) {
      throw new GeneratorError('refused', serverMessage || 'This request could not be written up. Please rephrase the topic and try again.');
    }
    throw new GeneratorError('server', 'The AI writing service is having trouble right now. Please try again in a moment.');
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    throw new GeneratorError('network', 'We could not reach the AI writing service. Check your internet connection and try again.');
  }
  throw new GeneratorError('server', 'Something went wrong while generating. Please try again.');
}

async function run(input: GeneratorInput, variations: Variation[]): Promise<GenerationResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new GeneratorError('network', 'You appear to be offline. Reconnect and try again.');
  }
  if (PROVIDER === 'mock') {
    const posts = await mockGenerate(input, variations);
    return { posts: posts.map((p) => ({ ...p, characterCount: postLength(p) })), source: 'mock' };
  }
  const raw = await callEdgeFunction(input, variations);
  return { posts: normalisePosts(raw, variations), source: 'ai' };
}

/**
 * Generates one post per variation (all five by default) from a cleaned
 * copy of the input. The cleaned input is returned so later single-card
 * regenerations use the same corrected text.
 */
export async function generateLinkedInPosts(
  rawInput: GeneratorInput,
): Promise<GenerationResult & { input: GeneratorInput; corrections: Correction[] }> {
  const errors = validateInput(rawInput);
  if (Object.keys(errors).length) {
    throw new GeneratorError('validation', Object.values(errors)[0]);
  }
  const { input, corrections } = cleanInput(rawInput);
  const result = await run(input, VARIATIONS);
  return { ...result, input, corrections };
}

/** Regenerates a single variation, leaving the others untouched. */
export async function regenerateVariation(input: GeneratorInput, variationKey: string): Promise<GeneratedPost> {
  const variation = VARIATIONS.find((v) => v.key === variationKey);
  if (!variation) throw new GeneratorError('validation', 'Unknown post variation.');
  const { posts } = await run(input, [variation]);
  return posts[0];
}

export { LINKEDIN_CHAR_LIMIT };
export type { Correction };
