import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptKeyWithFallback } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1200;
const MAX_RETRIES = 2;
const COOLDOWN_DURATION_MS = 60000;

// Input validation constants
const MAX_THEME_LENGTH = 200;
const MAX_NEGATIVE_PROMPT_LENGTH = 500;
const MIN_WORD_COUNT = 10;
const MAX_WORD_COUNT = 60;
const MAX_PROMPT_COUNT = 1000;

// Valid output types (LEVEL 1 - MANDATORY)
const VALID_OUTPUT_TYPES = ['photo', 'video', 'vector', 'illustration', 'typography', 'ui_screen'];

// Valid style modes (LEVEL 2 - OPTIONAL)
const VALID_STYLE_MODES = ['cinematic', 'glitch', 'retro', 'cyberpunk', 'minimal', 'analog', 'neon', 'vintage'];

// Valid moods (LEVEL 3 - OPTIONAL)
const VALID_MOODS = ['dark', 'calm', 'futuristic', 'horror', 'energetic', 'dreamy', 'mysterious', 'uplifting'];

// Valid providers
const VALID_PROVIDERS = ['groq', 'openrouter'];

// Provider endpoints
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

interface KeyRotationState {
  currentIndex: number;
  keys: ApiKeyRecord[];
}

function getAvailableKeys(keys: ApiKeyRecord[], provider: string): ApiKeyRecord[] {
  const now = new Date();
  
  return keys
    .filter(key => {
      // Filter by provider
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
  return theme
    .slice(0, MAX_THEME_LENGTH)
    .replace(/[<>&"'\\]/g, '')
    .trim();
}

function sanitizeNegativePrompt(negativePrompt: string | null): string | null {
  if (!negativePrompt) return null;
  return negativePrompt
    .slice(0, MAX_NEGATIVE_PROMPT_LENGTH)
    .replace(/[<>&"'\\]/g, '')
    .trim() || null;
}

function getOutputTypeLabel(outputType: string): string {
  const labels: Record<string, string> = {
    'photo': 'Photo',
    'video': 'Video',
    'vector': 'Vector',
    'illustration': 'Illustration',
    'typography': 'Typography',
    'ui_screen': 'UI / Screen',
  };
  return labels[outputType] || outputType;
}

function getStyleModeLabel(styleMode: string | null): string | null {
  if (!styleMode) return null;
  const labels: Record<string, string> = {
    'cinematic': 'Cinematic',
    'glitch': 'Glitch',
    'retro': 'Retro',
    'cyberpunk': 'Cyberpunk',
    'minimal': 'Minimal',
    'analog': 'Analog',
    'neon': 'Neon',
    'vintage': 'Vintage',
  };
  return labels[styleMode] || styleMode;
}

function getMoodLabel(mood: string | null): string | null {
  if (!mood) return null;
  const labels: Record<string, string> = {
    'dark': 'Dark',
    'calm': 'Calm',
    'futuristic': 'Futuristic',
    'horror': 'Horror',
    'energetic': 'Energetic',
    'dreamy': 'Dreamy',
    'mysterious': 'Mysterious',
    'uplifting': 'Uplifting',
  };
  return labels[mood] || mood;
}

function buildPromptSystem(
  theme: string,
  outputType: string,
  styleMode: string | null,
  mood: string | null,
  negativePrompt: string | null,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): string {
  const sanitizedTheme = sanitizeTheme(theme);
  const outputTypeLabel = getOutputTypeLabel(outputType);
  const styleModeLabel = getStyleModeLabel(styleMode);
  const moodLabel = getMoodLabel(mood);
  
  // Build the core rules based on OUTPUT TYPE (Level 1 - MANDATORY)
  let outputTypeRules = '';
  switch (outputType) {
    case 'photo':
      outputTypeRules = `
OUTPUT TYPE: PHOTO
Generate prompts for photorealistic images.
- Describe real-world scenes, people, objects, or environments
- Include camera specifications when relevant (lens, aperture, angle)
- Focus on lighting, composition, and realistic details
- Use photography terminology (bokeh, depth of field, golden hour, etc.)`;
      break;
      
    case 'video':
      outputTypeRules = `
OUTPUT TYPE: VIDEO
Generate prompts suitable for video/animation generation.
- Describe motion, movement, and temporal changes
- Include camera movement (pan, zoom, tracking shot)
- Focus on action sequences or transitional scenes
- Suitable for AI video generation tools`;
      break;
      
    case 'illustration':
      outputTypeRules = `
OUTPUT TYPE: ILLUSTRATION
Generate prompts for artistic illustrations.
- Describe scenes with artistic interpretation
- Include style references (painterly, digital art, concept art, etc.)
- Focus on composition, color palette, and artistic mood
- Can be stylized, fantastical, or interpretive`;
      break;
      
    case 'vector':
      outputTypeRules = `
OUTPUT TYPE: VECTOR
Generate prompts for vector graphics and flat designs.
- Focus on clean lines, geometric shapes, and flat colors
- Describe logo-like or icon-like compositions
- Use terms like flat design, minimalist, geometric, clean edges
- Suitable for scalable graphics and branding`;
      break;
      
    case 'typography':
      outputTypeRules = `
OUTPUT TYPE: TYPOGRAPHY
Generate prompts centered on text and lettering.
- The main subject MUST be text, letters, or typography
- Describe font styles (serif, sans-serif, script, display, etc.)
- Include text arrangement, composition, and styling
- Specify colors, textures, or materials for the letters`;
      break;
      
    case 'ui_screen':
      outputTypeRules = `
OUTPUT TYPE: UI / SCREEN
Generate prompts for interface and screen designs.
- Focus on digital interfaces, HUDs, dashboards, or system screens
- Include UI elements (buttons, panels, data visualizations)
- Describe screen layouts, holographic displays, or terminal interfaces
- Use tech-inspired aesthetics and system-like visuals`;
      break;
      
    default:
      outputTypeRules = `
OUTPUT TYPE: ${outputTypeLabel}
Generate creative visual prompts based on the theme.`;
  }

  // Build optional style modifiers (Level 2 - OPTIONAL)
  let styleRules = '';
  if (styleMode) {
    styleRules = `
STYLE MODE: ${styleModeLabel}
Apply this visual style to the prompts:`;
    switch (styleMode) {
      case 'cinematic':
        styleRules += ` dramatic lighting, film-like composition, wide aspect ratio feel, movie quality`;
        break;
      case 'glitch':
        styleRules += ` digital glitch effects, RGB split, pixel artifacts, data corruption, scanlines`;
        break;
      case 'retro':
        styleRules += ` vintage aesthetics, old-school vibes, nostalgic feel, period-appropriate styling`;
        break;
      case 'cyberpunk':
        styleRules += ` neon lights, high-tech low-life, futuristic urban, dystopian elements`;
        break;
      case 'minimal':
        styleRules += ` clean and simple, reduced elements, essential forms only, whitespace`;
        break;
      case 'analog':
        styleRules += ` film grain, analog camera feel, organic imperfections, warm tones`;
        break;
      case 'neon':
        styleRules += ` bright neon colors, glowing effects, vibrant light sources, electric feel`;
        break;
      case 'vintage':
        styleRules += ` aged appearance, historical feel, classic aesthetics, timeless quality`;
        break;
    }
  }

  // Build optional mood modifiers (Level 3 - OPTIONAL)
  let moodRules = '';
  if (mood) {
    moodRules = `
MOOD: ${moodLabel}
Convey this emotional tone:`;
    switch (mood) {
      case 'dark':
        moodRules += ` shadows, low-key lighting, ominous atmosphere, dramatic contrast`;
        break;
      case 'calm':
        moodRules += ` peaceful, serene, tranquil atmosphere, soft tones`;
        break;
      case 'futuristic':
        moodRules += ` advanced technology, forward-looking, sci-fi inspired`;
        break;
      case 'horror':
        moodRules += ` unsettling, eerie, frightening elements, tension`;
        break;
      case 'energetic':
        moodRules += ` dynamic, vibrant, high energy, movement and action`;
        break;
      case 'dreamy':
        moodRules += ` ethereal, soft focus, fantasy-like, surreal quality`;
        break;
      case 'mysterious':
        moodRules += ` enigmatic, hidden elements, intrigue, atmospheric`;
        break;
      case 'uplifting':
        moodRules += ` positive, bright, hopeful, inspiring feeling`;
        break;
    }
  }

  // Build negative prompt instruction
  let negativePromptRules = '';
  if (negativePrompt) {
    negativePromptRules = `
NEGATIVE PROMPT HANDLING:
- At the END of each generated prompt, append: " — avoid: ${negativePrompt}"
- The negative prompt must NOT override or change the main theme
- Keep it as a suffix, not integrated into the main description`;
  }

  // Base system prompt - TEXT ONLY OUTPUT
  const baseRules = `You are a specialized text-to-image prompt generator.

THEME (NEVER OVERRIDE): ${sanitizedTheme}
${outputTypeRules}
${styleRules}
${moodRules}
${negativePromptRules}

CRITICAL RULES:
1. THEME is the core concept - never replace or override it
2. OUTPUT TYPE defines the fundamental structure of each prompt
3. Style Mode and Mood are OPTIONAL modifiers - only apply if specified
4. Do NOT force glitch effects unless STYLE MODE is "Glitch"
5. Do NOT force typography unless OUTPUT TYPE is "Typography" or "UI / Screen"

PROMPT LENGTH RULE (STRICT):
- Each prompt MUST be exactly ONE sentence
- Word count MUST be between ${minWords} and ${maxWords} words
- If too short → expand with more relevant detail
- If too long → compress while keeping essential elements

QUALITY RULES:
- No generic or repetitive prompts
- Vary sentence openings and structures
- Each prompt must be unique and creative

OUTPUT FORMAT: PLAIN TEXT (STRICT)
Return ONLY a numbered list of prompts.
Format: "1. [prompt text]" on each line.
NO JSON, NO markdown, NO code blocks, NO explanations.
Just the numbered list, nothing else.

Example output:
1. A serene mountain landscape at dawn with mist rolling through the valleys.
2. An ancient forest path covered in golden autumn leaves under soft sunlight.`;

  if (batchNumber === 1) {
    return `${baseRules}

Generate exactly ${batchSize} unique prompts.

Generate ${batchSize} prompts NOW:`;
  }

  const recentPrompts = previousPrompts.slice(-5);
  return `${baseRules}

Continue generating NEW prompts only.
Previous prompts ended at number ${startNumber - 1}.

Additional rules for continuation:
- Generate exactly ${batchSize} NEW prompts
- Do NOT repeat concepts, metaphors, or wording from previous batches
- Maintain consistent theme and quality

Previous batch ended with (DO NOT repeat these):
${recentPrompts.map((p) => `  - "${p}"`).join('\n')}

Generate ${batchSize} NEW prompts NOW:`;
}

function parseModelOutput(content: string, batchSize: number): string[] {
  const prompts: string[] = [];
  
  // TEXT format: parse as numbered list
  const lines = content.split('\n');
  for (const line of lines) {
    // Match patterns like "1. prompt", "1) prompt", "1: prompt", or just numbered lines
    const match = line.match(/^\s*\d+[\.\)\:]\s*(.+)/);
    if (match && match[1]) {
      const prompt = match[1].replace(/^["']|["']$/g, '').trim();
      if (prompt.length > 15) {
        prompts.push(prompt);
      }
    }
  }
  
  // Fallback: if no numbered format found, try splitting by lines
  if (prompts.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 20 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        prompts.push(trimmed);
      }
    }
  }
  
  return prompts.slice(0, batchSize);
}

function validatePromptBasic(prompt: string, minWords: number, maxWords: number): boolean {
  const words = prompt.split(/\s+/).length;
  // Allow some tolerance (80% min, 120% max)
  return words >= minWords * 0.8 && words <= maxWords * 1.2 && prompt.length > 20;
}

async function generateBatch(
  apiKey: string,
  provider: string,
  theme: string,
  outputType: string,
  styleMode: string | null,
  mood: string | null,
  negativePrompt: string | null,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): Promise<BatchResult> {
  const systemPrompt = buildPromptSystem(
    theme,
    outputType,
    styleMode,
    mood,
    negativePrompt,
    batchNumber,
    batchSize,
    startNumber,
    minWords,
    maxWords,
    previousPrompts
  );

  const endpoint = PROVIDER_ENDPOINTS[provider as keyof typeof PROVIDER_ENDPOINTS];
  
  // Build headers based on provider
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  
  // OpenRouter requires additional headers
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
        { role: "user", content: `Generate ${batchSize} ${getOutputTypeLabel(outputType)} prompts with theme: ${sanitizeTheme(theme)}` },
      ],
      temperature: 0.9,
      max_tokens: 3000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${provider} API error:`, response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("INVALID_KEY");
    }
    throw new Error(`API request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No response from AI model");
  }

  console.log(`Raw model output (first 500 chars): ${content.slice(0, 500)}`);

  // Parse as plain text numbered list
  const prompts = parseModelOutput(content, batchSize);
  
  // Validate prompts
  const validPrompts = prompts.filter(p => validatePromptBasic(p, minWords, maxWords));

  console.log(`Parsed ${prompts.length} prompts, ${validPrompts.length} valid after filtering`);

  return {
    prompts: validPrompts,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

async function generateBatchWithRotation(
  supabase: SupabaseClient,
  rotationState: KeyRotationState,
  encryptionKey: string,
  provider: string,
  theme: string,
  outputType: string,
  styleMode: string | null,
  mood: string | null,
  negativePrompt: string | null,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): Promise<{ result: BatchResult; usedKeyId: string }> {
  let lastError: Error | null = null;
  
  const availableKeys = getAvailableKeys(rotationState.keys, provider);
  
  if (availableKeys.length === 0) {
    throw new Error(`No active ${provider === 'groq' ? 'Groq' : 'OpenRouter'} API keys available. Please add a key or wait for cooldown.`);
  }

  for (const keyRecord of availableKeys) {
    const apiKey = await decryptKeyWithFallback(keyRecord.encrypted_key, encryptionKey);
    
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        if (retry > 0) {
          console.log(`Retry ${retry} for batch ${batchNumber} with key ${keyRecord.id.slice(0, 8)}`);
          await delay(BATCH_DELAY_MS * (retry + 1));
        }
        
        const result = await generateBatch(
          apiKey,
          provider,
          theme,
          outputType,
          styleMode,
          mood,
          negativePrompt,
          model, 
          batchNumber, 
          batchSize,
          startNumber,
          minWords,
          maxWords,
          previousPrompts
        );
        
        // CRITICAL: Check if we got any prompts
        if (result.prompts.length === 0) {
          console.warn(`Batch ${batchNumber} returned 0 prompts, retrying...`);
          if (retry < MAX_RETRIES) {
            continue; // Try again
          }
          throw new Error("EMPTY_BATCH");
        }
        
        await supabase
          .from("api_keys")
          .update({ 
            last_used_at: new Date().toISOString(),
            cooldown_until: null 
          } as Record<string, unknown>)
          .eq("id", keyRecord.id);
        
        keyRecord.last_used_at = new Date().toISOString();
        keyRecord.cooldown_until = null;
        
        return { result, usedKeyId: keyRecord.id };
      } catch (error) {
        lastError = error as Error;
        console.error(`Batch ${batchNumber}, key ${keyRecord.id.slice(0, 8)}, retry ${retry}:`, error);
        
        if ((error as Error).message === "RATE_LIMIT") {
          const cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS).toISOString();
          
          await supabase
            .from("api_keys")
            .update({ cooldown_until: cooldownUntil } as Record<string, unknown>)
            .eq("id", keyRecord.id);
          
          keyRecord.cooldown_until = cooldownUntil;
          
          console.log(`Key ${keyRecord.id.slice(0, 8)} set to cooldown until ${cooldownUntil}`);
          break;
        }
        
        if ((error as Error).message === "INVALID_KEY") {
          await supabase
            .from("api_keys")
            .update({ is_active: false } as Record<string, unknown>)
            .eq("id", keyRecord.id);
          
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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const encryptionKey = Deno.env.get("GROQ_ENCRYPTION_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { 
      theme, 
      provider = 'groq',
      model, 
      outputType = 'illustration',
      styleMode = null,
      mood = null,
      negativePrompt = null,
      count = 20, 
      minWords = 22, 
      maxWords = 35 
    } = await req.json();

    // Validate theme
    if (!theme || typeof theme !== "string") {
      return new Response(
        JSON.stringify({ error: "Theme is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (theme.length > MAX_THEME_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Theme must be ${MAX_THEME_LENGTH} characters or less` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate provider
    const validProvider = VALID_PROVIDERS.includes(provider) ? provider : 'groq';

    // Validate output type (LEVEL 1 - MANDATORY)
    const validOutputType = VALID_OUTPUT_TYPES.includes(outputType) ? outputType : 'illustration';
    
    // Validate style mode (LEVEL 2 - OPTIONAL)
    const validStyleMode = styleMode && VALID_STYLE_MODES.includes(styleMode) ? styleMode : null;
    
    // Validate mood (LEVEL 3 - OPTIONAL)
    const validMood = mood && VALID_MOODS.includes(mood) ? mood : null;
    
    // Sanitize negative prompt
    const validNegativePrompt = sanitizeNegativePrompt(negativePrompt);

    // Validate and sanitize numeric inputs
    const totalCount = Math.min(Math.max(1, Number(count) || 20), MAX_PROMPT_COUNT);
    const validMinWords = Math.min(Math.max(MIN_WORD_COUNT, Number(minWords) || 22), MAX_WORD_COUNT);
    const validMaxWords = Math.min(Math.max(validMinWords + 5, Number(maxWords) || 35), MAX_WORD_COUNT);

    const { data: keys, error: keysError } = await supabase
      .from("api_keys")
      .select("id, encrypted_key, provider, last_used_at, cooldown_until")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (keysError || !keys || keys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active API keys found. Please add an API key first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if we have keys for the selected provider
    const providerKeys = keys.filter(k => k.provider === validProvider);
    if (providerKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: `No active ${validProvider === 'groq' ? 'Groq' : 'OpenRouter'} API keys found. Please add a ${validProvider === 'groq' ? 'Groq' : 'OpenRouter'} key or switch providers.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rotationState: KeyRotationState = {
      currentIndex: 0,
      keys: keys as ApiKeyRecord[],
    };

    const numBatches = Math.ceil(totalCount / BATCH_SIZE);
    console.log(`Generating ${totalCount} ${getOutputTypeLabel(validOutputType)} prompts in ${numBatches} batch(es) with ${providerKeys.length} available ${validProvider} key(s)`);
    console.log(`Provider: ${validProvider}, Style: ${validStyleMode || 'none'}, Mood: ${validMood || 'none'}`);

    const allPrompts: string[] = [];
    let totalTokensUsed = 0;

    for (let batchNum = 1; batchNum <= numBatches; batchNum++) {
      const isLastBatch = batchNum === numBatches;
      const batchSize = isLastBatch ? (totalCount - (batchNum - 1) * BATCH_SIZE) : BATCH_SIZE;
      const startNumber = (batchNum - 1) * BATCH_SIZE + 1;
      
      console.log(`Processing batch ${batchNum}/${numBatches} (prompts ${startNumber}-${startNumber + batchSize - 1})`);

      try {
        const { result, usedKeyId } = await generateBatchWithRotation(
          supabase,
          rotationState,
          encryptionKey,
          validProvider,
          theme,
          validOutputType,
          validStyleMode,
          validMood,
          validNegativePrompt,
          model,
          batchNum,
          batchSize,
          startNumber,
          validMinWords,
          validMaxWords,
          allPrompts
        );

        allPrompts.push(...result.prompts);
        totalTokensUsed += result.tokensUsed;

        console.log(`Batch ${batchNum} complete: ${result.prompts.length} prompts, ${result.tokensUsed} tokens, key ${usedKeyId.slice(0, 8)}`);

        if (!isLastBatch) {
          await delay(BATCH_DELAY_MS);
        }
      } catch (error) {
        console.error(`Batch ${batchNum} failed:`, error);
        
        if (allPrompts.length > 0) {
          console.log(`Returning partial results: ${allPrompts.length} prompts`);
          
          await supabase.from("prompt_logs").insert({
            user_id: user.id,
            model: model || (validProvider === 'groq' ? "llama-3.3-70b-versatile" : "xiaomi/mimo-v2-flash:free"),
            prompt_count: allPrompts.length,
            tokens_used: totalTokensUsed,
          } as Record<string, unknown>);

          return new Response(
            JSON.stringify({ 
              prompts: allPrompts,
              provider: validProvider,
              outputType: validOutputType,
              styleMode: validStyleMode,
              mood: validMood,
              partial: true,
              completedBatches: batchNum - 1,
              totalBatches: numBatches,
              message: `Generated ${allPrompts.length} of ${totalCount} prompts. Some batches failed.`
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // CRITICAL: Never return success with 0 prompts
        const errorMessage = (error as Error).message || "Failed to generate prompts";
        return new Response(
          JSON.stringify({ error: errorMessage.includes("API keys") ? errorMessage : "Failed to generate prompts. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // CRITICAL: Final check - never return success with 0 prompts
    if (allPrompts.length === 0) {
      return new Response(
        JSON.stringify({ error: "Generation completed but no valid prompts were produced. Please try again with different settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("prompt_logs").insert({
      user_id: user.id,
      model: model || (validProvider === 'groq' ? "llama-3.3-70b-versatile" : "xiaomi/mimo-v2-flash:free"),
      prompt_count: allPrompts.length,
      tokens_used: totalTokensUsed,
    } as Record<string, unknown>);

    console.log(`Generation complete: ${allPrompts.length} prompts, ${totalTokensUsed} total tokens`);

    return new Response(
      JSON.stringify({ 
        prompts: allPrompts,
        provider: validProvider,
        outputType: validOutputType,
        styleMode: validStyleMode,
        mood: validMood,
        totalBatches: numBatches,
        completedBatches: numBatches
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
