// AI providers for the LinkedIn Post Generator.
//
// One function — generateJson() — asks the configured model for JSON
// matching a schema and returns the parsed object. Which model is used
// is a deployment setting, not a code change:
//
//   LLM_PROVIDER = gemini (default) | openai | anthropic
//
//   gemini     GEMINI_API_KEY     (optional GEMINI_MODEL, default gemini-3.6-flash;
//                                  GEMINI_FALLBACK_MODELS, default gemini-3.5-flash,gemini-3.5-flash-lite)
//   openai     OPENAI_API_KEY     (optional OPENAI_MODEL, default gpt-4.1-mini)
//   anthropic  ANTHROPIC_API_KEY  (optional ANTHROPIC_MODEL, default claude-opus-5)
//
// Every provider failure is mapped to a ProviderError with a small set of
// kinds, so index.ts can turn it into a friendly message without knowing
// which provider was used. Nothing here ever reaches the browser.

export type ProviderErrorKind = 'not_configured' | 'rate_limited' | 'refused' | 'truncated' | 'failed';

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface JsonRequest {
  system: string;
  user: string;
  /** Standard JSON Schema (object/array/string types, required, additionalProperties). */
  schema: Record<string, unknown>;
}

type Env = (name: string) => string | undefined;

const TIMEOUT_MS = 60_000;

// Busy / rate-limited / flaky responses are retried a couple of times with
// a short backoff before giving up — providers report temporary overload
// (e.g. Gemini's 503 "high demand") fairly often.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2_000];

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!RETRY_STATUSES.has(res.status) || attempt >= RETRY_DELAYS_MS.length) return res;
    // Don't retry "no credit" — it won't fix itself.
    if (res.status === 429 && /insufficient_quota/.test(await res.clone().text())) return res;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

function parseJson(text: string | undefined, provider: string): unknown {
  if (!text) throw new ProviderError('failed', `${provider}: empty response`);
  // Some models wrap JSON in a ```json fence despite JSON mode — strip it.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ProviderError('failed', `${provider}: response was not valid JSON`);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- Gemini

// Gemini's responseSchema is an OpenAPI subset: upper-case type names,
// no additionalProperties, and propertyOrdering to keep keys in order.
function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.required) out.required = schema.required;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
  if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  return out;
}

// Claude's structured outputs accept only minItems 0/1 and no maxItems;
// drop the array bounds there (the prompt still states the counts).
function withoutArrayBounds(schema: any): any {
  if (Array.isArray(schema)) return schema.map(withoutArrayBounds);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'maxItems' || (k === 'minItems' && (v as number) > 1)) continue;
    out[k] = withoutArrayBounds(v);
  }
  return out;
}

const GEMINI_BLOCKED = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

// Gemini models are tried in order: GEMINI_MODEL, then the comma-separated
// GEMINI_FALLBACK_MODELS. The next model is used when one is overloaded
// (503/429 after a retry) or no longer available (404) — Google retires
// model names for new users over time.
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const DEFAULT_GEMINI_FALLBACKS = 'gemini-3.5-flash,gemini-3.5-flash-lite';

async function gemini(req: JsonRequest, env: Env): Promise<unknown> {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new ProviderError('not_configured', 'GEMINI_API_KEY is not set');
  const models = [
    env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    ...(env('GEMINI_FALLBACK_MODELS') ?? DEFAULT_GEMINI_FALLBACKS).split(','),
  ]
    .map((m) => m.trim())
    .filter((m, i, all) => m && all.indexOf(m) === i);

  let lastError: ProviderError | undefined;
  for (const model of models) {
    try {
      return await geminiModel(req, key, model, env);
    } catch (error) {
      const retryable = error instanceof ProviderError && (error.kind === 'rate_limited' || /gemini 404/.test(error.message));
      if (!retryable) throw error;
      lastError = error as ProviderError;
    }
  }
  // Every model was busy or unavailable.
  throw lastError?.kind === 'rate_limited' ? lastError : new ProviderError('not_configured', lastError?.message ?? 'gemini: no usable model');
}

async function geminiModel(req: JsonRequest, key: string, model: string, env: Env): Promise<unknown> {
  const base = env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com';

  const res = await fetchWithRetry(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(req.schema),
      },
    }),
  });

  if (!res.ok) {
    const detail = await readError(res);
    if (res.status === 429 || res.status === 503) throw new ProviderError('rate_limited', `gemini ${res.status}: ${detail}`);
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
      throw new ProviderError('not_configured', `gemini ${res.status}: ${detail}`);
    }
    throw new ProviderError('failed', `gemini ${res.status}: ${detail}`);
  }

  const data: any = await res.json();
  if (data?.promptFeedback?.blockReason) {
    throw new ProviderError('refused', `gemini blocked prompt: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new ProviderError('failed', 'gemini: no candidates');
  if (GEMINI_BLOCKED.has(candidate.finishReason)) {
    throw new ProviderError('refused', `gemini finishReason ${candidate.finishReason}`);
  }
  if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('truncated', 'gemini hit MAX_TOKENS');

  // Skip "thought" parts some models return alongside the answer.
  const text = (candidate.content?.parts ?? [])
    .filter((p: any) => typeof p?.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('');
  return parseJson(text, 'gemini');
}

// ---------------------------------------------------------------- OpenAI

async function openai(req: JsonRequest, env: Env): Promise<unknown> {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new ProviderError('not_configured', 'OPENAI_API_KEY is not set');
  const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
  const base = env('OPENAI_BASE_URL') || 'https://api.openai.com';

  const res = await fetchWithRetry(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      // Strict structured output: the reply must match the schema exactly.
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'linkedin_posts', strict: true, schema: req.schema },
      },
    }),
  });

  if (!res.ok) {
    const detail = await readError(res);
    if (res.status === 429) {
      // "insufficient_quota" means the account has no credit — a setup
      // problem, not a temporary busy signal.
      if (/insufficient_quota/.test(detail)) throw new ProviderError('not_configured', `openai quota: ${detail}`);
      throw new ProviderError('rate_limited', `openai 429: ${detail}`);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError('not_configured', `openai ${res.status}: ${detail}`);
    if (res.status === 503) throw new ProviderError('rate_limited', `openai 503: ${detail}`);
    throw new ProviderError('failed', `openai ${res.status}: ${detail}`);
  }

  const data: any = await res.json();
  const choice = data?.choices?.[0];
  if (!choice) throw new ProviderError('failed', 'openai: no choices');
  if (choice.message?.refusal) throw new ProviderError('refused', `openai refusal: ${choice.message.refusal}`);
  if (choice.finish_reason === 'content_filter') throw new ProviderError('refused', 'openai content_filter');
  if (choice.finish_reason === 'length') throw new ProviderError('truncated', 'openai hit length limit');
  return parseJson(choice.message?.content, 'openai');
}

// ------------------------------------------------------------- Anthropic

async function anthropic(req: JsonRequest, env: Env): Promise<unknown> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new ProviderError('not_configured', 'ANTHROPIC_API_KEY is not set');
  // Loaded only when this provider is selected.
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });

  let response: any;
  try {
    response = await client.beta.messages.create({
      model: env('ANTHROPIC_MODEL') || 'claude-opus-5',
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: { type: 'json_schema', schema: withoutArrayBounds(req.schema) } },
      // On a safety decline, re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as any);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited', 'anthropic 429');
    if (error instanceof Anthropic.AuthenticationError) throw new ProviderError('not_configured', 'anthropic auth failed');
    throw new ProviderError('failed', `anthropic: ${error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error}`);
  }
  if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'anthropic refusal');
  if (response.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'anthropic max_tokens');
  return parseJson(response.content?.find((b: any) => b.type === 'text')?.text, 'anthropic');
}

// ---------------------------------------------------------------- entry

const PROVIDERS = { gemini, openai, anthropic } as const;

export function providerName(env: Env): keyof typeof PROVIDERS {
  const name = (env('LLM_PROVIDER') || 'gemini').toLowerCase();
  return name in PROVIDERS ? (name as keyof typeof PROVIDERS) : 'gemini';
}

export async function generateJson(req: JsonRequest, env: Env): Promise<unknown> {
  const provider = PROVIDERS[providerName(env)];
  try {
    return await provider(req, env);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // Network errors and timeouts.
    const timedOut = (error as Error)?.name === 'TimeoutError';
    throw new ProviderError('failed', `${providerName(env)} ${timedOut ? 'timed out' : `request failed: ${error}`}`);
  }
}
