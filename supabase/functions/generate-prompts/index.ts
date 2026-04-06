// ============================================================================
// SINGLE-BATCH EDGE FUNCTION
// ============================================================================
// This function generates ONE batch of prompts per invocation.
// All batching, looping, and delays are handled CLIENT-SIDE to avoid
// Vercel serverless timeouts. Each call completes in under 10 seconds.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptKeyWithFallback } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const COOLDOWN_DURATION_MS = 60000;

const MAX_THEME_LENGTH = 200;
const MAX_NEGATIVE_PROMPT_LENGTH = 500;
const MIN_WORD_COUNT = 10;
const MAX_WORD_COUNT = 60;
const MAX_BATCH_SIZE = 25;

const VALID_OUTPUT_TYPES = ['photo', 'video', 'vector', 'illustration', 'typography', 'ui_screen'];
const VALID_STYLE_MODES = ['cinematic', 'glitch', 'retro', 'cyberpunk', 'minimal', 'analog', 'neon', 'vintage'];
const VALID_MOODS = ['dark', 'calm', 'futuristic', 'horror', 'energetic', 'dreamy', 'mysterious', 'uplifting'];
const VALID_PROVIDERS = ['groq', 'openrouter', 'gemini'];

const PROVIDER_ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ApiKeyRecord {
  id: string;
  encrypted_key: string;
  provider: string;
  last_used_at: string | null;
  cooldown_until: string | null;
}

interface BatchResult {
  prompts: string[];
  tokensUsed: number;
}

function getAvailableKeys(keys: ApiKeyRecord[], provider: string): ApiKeyRecord[] {
  const now = new Date();
  return keys
    .filter(key => {
      if (key.provider !== provider) return false;
      if (key.cooldown_until) {
        const cooldownEnd = new Date(key.cooldown_until);
        if (cooldownEnd > now) {
          console.log(`Key ${key.id.slice(0, 8)} is in cooldown until ${cooldownEnd.toISOString()}`);
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
      const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
      return aTime - bTime;
    });
}

function sanitizeTheme(theme: string): string {
  return theme.slice(0, MAX_THEME_LENGTH).replace(/[<>&"'\\]/g, '').trim();
}

function sanitizeNegativePrompt(negativePrompt: string | null): string | null {
  if (!negativePrompt) return null;
  return negativePrompt.slice(0, MAX_NEGATIVE_PROMPT_LENGTH).replace(/[<>&"'\\]/g, '').trim() || null;
}

function getOutputTypeLabel(outputType: string): string {
  const labels: Record<string, string> = { 'photo': 'Photo', 'video': 'Video', 'vector': 'Vector', 'illustration': 'Illustration', 'typography': 'Typography', 'ui_screen': 'UI / Screen' };
  return labels[outputType] || outputType;
}

function getStyleModeLabel(styleMode: string | null): string | null {
  if (!styleMode) return null;
  const labels: Record<string, string> = { 'cinematic': 'Cinematic', 'glitch': 'Glitch', 'retro': 'Retro', 'cyberpunk': 'Cyberpunk', 'minimal': 'Minimal', 'analog': 'Analog', 'neon': 'Neon', 'vintage': 'Vintage' };
  return labels[styleMode] || styleMode;
}

function getMoodLabel(mood: string | null): string | null {
  if (!mood) return null;
  const labels: Record<string, string> = { 'dark': 'Dark', 'calm': 'Calm', 'futuristic': 'Futuristic', 'horror': 'Horror', 'energetic': 'Energetic', 'dreamy': 'Dreamy', 'mysterious': 'Mysterious', 'uplifting': 'Uplifting' };
  return labels[mood] || mood;
}

function buildPromptSystem(
  theme: string, outputType: string, styleMode: string | null, mood: string | null,
  negativePrompt: string | null, batchNumber: number, batchSize: number, startNumber: number,
  minWords: number, maxWords: number, previousPrompts: string[]
): string {
  const sanitizedTheme = sanitizeTheme(theme);
  const outputTypeLabel = getOutputTypeLabel(outputType);
  const styleModeLabel = getStyleModeLabel(styleMode);
  const moodLabel = getMoodLabel(mood);

  let outputTypeRules = '';
  switch (outputType) {
    case 'photo':
      outputTypeRules = `\nOUTPUT TYPE: PHOTO\nGenerate prompts for photorealistic images.\n- Describe real-world scenes, people, objects, or environments\n- Include camera specifications when relevant (lens, aperture, angle)\n- Focus on lighting, composition, and realistic details\n- Use photography terminology (bokeh, depth of field, golden hour, etc.)`;
      break;
    case 'video':
      outputTypeRules = `\nOUTPUT TYPE: VIDEO\nGenerate prompts suitable for video/animation generation.\n- Describe motion, movement, and temporal changes\n- Include camera movement (pan, zoom, tracking shot)\n- Focus on action sequences or transitional scenes\n- Suitable for AI video generation tools`;
      break;
    case 'illustration':
      outputTypeRules = `\nOUTPUT TYPE: ILLUSTRATION\nGenerate prompts for artistic illustrations.\n- Describe scenes with artistic interpretation\n- Include style references (painterly, digital art, concept art, etc.)\n- Focus on composition, color palette, and artistic mood\n- Can be stylized, fantastical, or interpretive`;
      break;
    case 'vector':
      outputTypeRules = `\nOUTPUT TYPE: VECTOR\nGenerate prompts for vector graphics and flat designs.\n- Focus on clean lines, geometric shapes, and flat colors\n- Describe logo-like or icon-like compositions\n- Use terms like flat design, minimalist, geometric, clean edges\n- Suitable for scalable graphics and branding`;
      break;
    case 'typography':
      outputTypeRules = `\nOUTPUT TYPE: TYPOGRAPHY\nGenerate prompts centered on text and lettering.\n- The main subject MUST be text, letters, or typography\n- Describe font styles (serif, sans-serif, script, display, etc.)\n- Include text arrangement, composition, and styling\n- Specify colors, textures, or materials for the letters`;
      break;
    case 'ui_screen':
      outputTypeRules = `\nOUTPUT TYPE: UI / SCREEN\nGenerate prompts for interface and screen designs.\n- Focus on digital interfaces, HUDs, dashboards, or system screens\n- Include UI elements (buttons, panels, data visualizations)\n- Describe screen layouts, holographic displays, or terminal interfaces\n- Use tech-inspired aesthetics and system-like visuals`;
      break;
    default:
      outputTypeRules = `\nOUTPUT TYPE: ${outputTypeLabel}\nGenerate creative visual prompts based on the theme.`;
  }

  let styleRules = '';
  if (styleMode) {
    styleRules = `\nSTYLE MODE: ${styleModeLabel}\nApply this visual style to the prompts:`;
    switch (styleMode) {
      case 'cinematic': styleRules += ` dramatic lighting, film-like composition, wide aspect ratio feel, movie quality`; break;
      case 'glitch': styleRules += ` digital glitch effects, RGB split, pixel artifacts, data corruption, scanlines`; break;
      case 'retro': styleRules += ` vintage aesthetics, old-school vibes, nostalgic feel, period-appropriate styling`; break;
      case 'cyberpunk': styleRules += ` neon lights, high-tech low-life, futuristic urban, dystopian elements`; break;
      case 'minimal': styleRules += ` clean and simple, reduced elements, essential forms only, whitespace`; break;
      case 'analog': styleRules += ` film grain, analog camera feel, organic imperfections, warm tones`; break;
      case 'neon': styleRules += ` bright neon colors, glowing effects, vibrant light sources, electric feel`; break;
      case 'vintage': styleRules += ` aged appearance, historical feel, classic aesthetics, timeless quality`; break;
    }
  }

  let moodRules = '';
  if (mood) {
    moodRules = `\nMOOD: ${moodLabel}\nConvey this emotional tone:`;
    switch (mood) {
      case 'dark': moodRules += ` shadows, low-key lighting, ominous atmosphere, dramatic contrast`; break;
      case 'calm': moodRules += ` peaceful, serene, tranquil atmosphere, soft tones`; break;
      case 'futuristic': moodRules += ` advanced technology, forward-looking, sci-fi inspired`; break;
      case 'horror': moodRules += ` unsettling, eerie, frightening elements, tension`; break;
      case 'energetic': moodRules += ` dynamic, vibrant, high energy, movement and action`; break;
      case 'dreamy': moodRules += ` ethereal, soft focus, fantasy-like, surreal quality`; break;
      case 'mysterious': moodRules += ` enigmatic, hidden elements, intrigue, atmospheric`; break;
      case 'uplifting': moodRules += ` positive, bright, hopeful, inspiring feeling`; break;
    }
  }

  let negativePromptRules = '';
  if (negativePrompt) {
    negativePromptRules = `\nNEGATIVE PROMPT HANDLING:\n- At the END of each generated prompt, append: " \u2014 avoid: ${negativePrompt}"\n- The negative prompt must NOT override or change the main theme\n- Keep it as a suffix, not integrated into the main description`;
  }

  const baseRules = `You are a specialized text-to-image prompt generator.\n\nTHEME (NEVER OVERRIDE): ${sanitizedTheme}\n${outputTypeRules}\n${styleRules}\n${moodRules}\n${negativePromptRules}\n\nCRITICAL RULES:\n1. THEME is the core concept - never replace or override it\n2. OUTPUT TYPE defines the fundamental structure of each prompt\n3. Style Mode and Mood are OPTIONAL modifiers - only apply if specified\n4. Do NOT force glitch effects unless STYLE MODE is "Glitch"\n5. Do NOT force typography unless OUTPUT TYPE is "Typography" or "UI / Screen"\n\nPROMPT LENGTH RULE (STRICT):\n- Each prompt MUST be exactly ONE sentence\n- Word count MUST be between ${minWords} and ${maxWords} words\n- If too short \u2192 expand with more relevant detail\n- If too long \u2192 compress while keeping essential elements\n\nQUALITY RULES:\n- No generic or repetitive prompts\n- Vary sentence openings and structures\n- Each prompt must be unique and creative\n\nOUTPUT FORMAT: PLAIN TEXT (STRICT)\nReturn ONLY a numbered list of prompts.\nFormat: "1. [prompt text]" on each line.\nNO JSON, NO markdown, NO code blocks, NO explanations.\nJust the numbered list, nothing else.\n\nExample output:\n1. A serene mountain landscape at dawn with mist rolling through the valleys.\n2. An ancient forest path covered in golden autumn leaves under soft sunlight.`;

  if (batchNumber === 1) {
    return `${baseRules}\n\nGenerate exactly ${batchSize} unique prompts.\n\nGenerate ${batchSize} prompts NOW:`;
  }

  const recentPrompts = previousPrompts.slice(-5);
  return `${baseRules}\n\nContinue generating NEW prompts only.\nPrevious prompts ended at number ${startNumber - 1}.\n\nAdditional rules for continuation:\n- Generate exactly ${batchSize} NEW prompts\n- Do NOT repeat concepts, metaphors, or wording from previous batches\n- Maintain consistent theme and quality\n\nPrevious batch ended with (DO NOT repeat these):\n${recentPrompts.map((p) => `  - "${p}"`).join('\n')}\n\nGenerate ${batchSize} NEW prompts NOW:`;
}

function parseModelOutput(content: string, batchSize: number): string[] {
  const prompts: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)\:]\s*(.+)/);
    if (match && match[1]) {
      const prompt = match[1].replace(/^["']|["']$/g, '').trim();
      if (prompt.length > 15) prompts.push(prompt);
    }
  }
  if (prompts.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 20 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) prompts.push(trimmed);
    }
  }
  return prompts.slice(0, batchSize);
}

function validatePromptBasic(prompt: string, minWords: number, maxWords: number): boolean {
  const words = prompt.split(/\s+/).length;
  return words >= minWords * 0.8 && words <= maxWords * 1.2 && prompt.length > 20;
}

async function generateBatch(
  apiKey: string, provider: string, theme: string, outputType: string,
  styleMode: string | null, mood: string | null, negativePrompt: string | null,
  model: string, batchNumber: number, batchSize: number, startNumber: number,
  minWords: number, maxWords: number, previousPrompts: string[]
): Promise<BatchResult> {
  const systemPrompt = buildPromptSystem(theme, outputType, styleMode, mood, negativePrompt, batchNumber, batchSize, startNumber, minWords, maxWords, previousPrompts);
  const userMessage = `Generate ${batchSize} ${getOutputTypeLabel(outputType)} prompts with theme: ${sanitizeTheme(theme)}`;

  let content: string;
  let tokensUsed: number;

  if (provider === 'gemini') {
    // Gemini API - different format
    const geminiModel = model || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.9, maxOutputTokens: 3000 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error:`, response.status, errorText);
      if (response.status === 429) throw new Error("RATE_LIMIT");
      if (response.status === 401 || response.status === 403) throw new Error("INVALID_KEY");
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    tokensUsed = data.usageMetadata?.totalTokenCount || 0;
  } else {
    // OpenAI-compatible format (Groq, OpenRouter)
    const endpoint = PROVIDER_ENDPOINTS[provider as keyof typeof PROVIDER_ENDPOINTS];
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (provider === 'openrouter') {
      headers["HTTP-Referer"] = "https://promptgen.lovable.app";
      headers["X-Title"] = "PromptGen";
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "xiaomi/mimo-v2-flash:free"),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.9,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${provider} API error:`, response.status, errorText);
      if (response.status === 429) throw new Error("RATE_LIMIT");
      if (response.status === 401 || response.status === 403) throw new Error("INVALID_KEY");
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    content = data.choices?.[0]?.message?.content;
    tokensUsed = data.usage?.total_tokens || 0;
  }

  if (!content) throw new Error("No response from AI model");

  console.log(`Raw model output (first 500 chars): ${content.slice(0, 500)}`);
  const prompts = parseModelOutput(content, batchSize);
  const validPrompts = prompts.filter(p => validatePromptBasic(p, minWords, maxWords));
  console.log(`Parsed ${prompts.length} prompts, ${validPrompts.length} valid after filtering`);

  return { prompts: validPrompts, tokensUsed };
}

async function generateSingleBatchWithRotation(
  supabase: SupabaseClient, keys: ApiKeyRecord[], encryptionKey: string, provider: string,
  theme: string, outputType: string, styleMode: string | null, mood: string | null,
  negativePrompt: string | null, model: string, batchNumber: number, batchSize: number,
  startNumber: number, minWords: number, maxWords: number, previousPrompts: string[]
): Promise<{ result: BatchResult; usedKeyId: string }> {
  let lastError: Error | null = null;
  const availableKeys = getAvailableKeys(keys, provider);

  if (availableKeys.length === 0) {
    const providerName = provider === 'groq' ? 'Groq' : provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
    throw new Error(`No active ${providerName} API keys available. Please add a key or wait for cooldown.`);
  }

  for (const keyRecord of availableKeys) {
    const apiKey = await decryptKeyWithFallback(keyRecord.encrypted_key, encryptionKey);
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        if (retry > 0) {
          console.log(`Retry ${retry} for batch ${batchNumber} with key ${keyRecord.id.slice(0, 8)}`);
          await delay(RETRY_DELAY_MS * (retry + 1));
        }
        const result = await generateBatch(apiKey, provider, theme, outputType, styleMode, mood, negativePrompt, model, batchNumber, batchSize, startNumber, minWords, maxWords, previousPrompts);
        if (result.prompts.length === 0) {
          console.warn(`Batch ${batchNumber} returned 0 prompts, retrying...`);
          if (retry < MAX_RETRIES) continue;
          throw new Error("EMPTY_BATCH");
        }
        await supabase.from("api_keys").update({ last_used_at: new Date().toISOString(), cooldown_until: null } as Record<string, unknown>).eq("id", keyRecord.id);
        return { result, usedKeyId: keyRecord.id };
      } catch (error) {
        lastError = error as Error;
        console.error(`Batch ${batchNumber}, key ${keyRecord.id.slice(0, 8)}, retry ${retry}:`, error);
        if ((error as Error).message === "RATE_LIMIT") {
          const cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS).toISOString();
          await supabase.from("api_keys").update({ cooldown_until: cooldownUntil } as Record<string, unknown>).eq("id", keyRecord.id);
          console.log(`Key ${keyRecord.id.slice(0, 8)} set to cooldown until ${cooldownUntil}`);
          break;
        }
        if ((error as Error).message === "INVALID_KEY") {
          await supabase.from("api_keys").update({ is_active: false } as Record<string, unknown>).eq("id", keyRecord.id);
          console.log(`Key ${keyRecord.id.slice(0, 8)} marked as inactive (invalid)`);
          break;
        }
      }
    }
  }
  throw lastError || new Error("All keys exhausted or in cooldown");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const encryptionKey = Deno.env.get("GROQ_ENCRYPTION_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { theme, provider = 'groq', model, outputType = 'illustration', styleMode = null, mood = null, negativePrompt = null, batchSize = 20, batchNumber = 1, startNumber = 1, previousPrompts = [], minWords = 22, maxWords = 35 } = await req.json();

    if (!theme || typeof theme !== "string") {
      return new Response(JSON.stringify({ error: "Theme is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (theme.length > MAX_THEME_LENGTH) {
      return new Response(JSON.stringify({ error: `Theme must be ${MAX_THEME_LENGTH} characters or less` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const validProvider = VALID_PROVIDERS.includes(provider) ? provider : 'groq';
    const validOutputType = VALID_OUTPUT_TYPES.includes(outputType) ? outputType : 'illustration';
    const validStyleMode = styleMode && VALID_STYLE_MODES.includes(styleMode) ? styleMode : null;
    const validMood = mood && VALID_MOODS.includes(mood) ? mood : null;
    const validNegativePrompt = sanitizeNegativePrompt(negativePrompt);
    const validBatchSize = Math.min(Math.max(1, Number(batchSize) || 20), MAX_BATCH_SIZE);
    const validBatchNumber = Math.max(1, Number(batchNumber) || 1);
    const validStartNumber = Math.max(1, Number(startNumber) || 1);
    const validMinWords = Math.min(Math.max(MIN_WORD_COUNT, Number(minWords) || 22), MAX_WORD_COUNT);
    const validMaxWords = Math.min(Math.max(validMinWords + 5, Number(maxWords) || 35), MAX_WORD_COUNT);
    const validPreviousPrompts = Array.isArray(previousPrompts) ? previousPrompts.slice(-5) : [];

    const { data: keys, error: keysError } = await supabase.from("api_keys").select("id, encrypted_key, provider, last_used_at, cooldown_until").eq("user_id", user.id).eq("is_active", true);
    if (keysError || !keys || keys.length === 0) {
      return new Response(JSON.stringify({ error: "No active API keys found. Please add an API key first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const providerKeys = keys.filter(k => k.provider === validProvider);
    if (providerKeys.length === 0) {
      const providerName = validProvider === 'groq' ? 'Groq' : validProvider === 'openrouter' ? 'OpenRouter' : 'Gemini';
      return new Response(JSON.stringify({ error: `No active ${providerName} API keys found.` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[Batch ${validBatchNumber}] Generating ${validBatchSize} ${getOutputTypeLabel(validOutputType)} prompts (start: ${validStartNumber})`);

    const { result, usedKeyId } = await generateSingleBatchWithRotation(supabase, keys as ApiKeyRecord[], encryptionKey, validProvider, theme, validOutputType, validStyleMode, validMood, validNegativePrompt, model, validBatchNumber, validBatchSize, validStartNumber, validMinWords, validMaxWords, validPreviousPrompts);

    const defaultModel = validProvider === 'groq' ? "llama-3.3-70b-versatile" : validProvider === 'openrouter' ? "xiaomi/mimo-v2-flash:free" : "gemini-2.5-flash";
    await supabase.from("prompt_logs").insert({ user_id: user.id, model: model || defaultModel, prompt_count: result.prompts.length, tokens_used: result.tokensUsed } as Record<string, unknown>);

    console.log(`[Batch ${validBatchNumber}] Complete: ${result.prompts.length} prompts, ${result.tokensUsed} tokens, key ${usedKeyId.slice(0, 8)}`);

    return new Response(JSON.stringify({ prompts: result.prompts, tokensUsed: result.tokensUsed, batchNumber: validBatchNumber, provider: validProvider, outputType: validOutputType, success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = (error as Error).message || "An unexpected error occurred";
    return new Response(JSON.stringify({ error: errorMessage.includes("API keys") ? errorMessage : "Failed to generate prompts. Please try again.", success: false }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
