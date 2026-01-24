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
const MIN_WORD_COUNT = 10;
const MAX_WORD_COUNT = 60;
const MAX_PROMPT_COUNT = 1000;

// Valid style modes
const VALID_STYLE_MODES = ['free_illustration', 'typography', 'glitch_typography', 'ui_tech_screen'];
const VALID_OUTPUT_FORMATS = ['json', 'text'];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ApiKeyRecord {
  id: string;
  encrypted_key: string;
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

function getAvailableKeys(keys: ApiKeyRecord[]): ApiKeyRecord[] {
  const now = new Date();
  
  return keys
    .filter(key => {
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

function getStyleModeLabel(styleMode: string): string {
  const labels: Record<string, string> = {
    'free_illustration': 'Free Illustration',
    'typography': 'Typography',
    'glitch_typography': 'Glitch Typography',
    'ui_tech_screen': 'UI / Tech Screen',
  };
  return labels[styleMode] || styleMode;
}

function buildPromptSystem(
  theme: string,
  styleMode: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  endNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): string {
  const sanitizedTheme = sanitizeTheme(theme);
  const styleModeLabel = getStyleModeLabel(styleMode);
  
  // Base rules that apply to all styles
  const baseRules = `
You are a specialized text-to-image prompt generator.

PROMPT LENGTH RULE (STRICT):
Each generated prompt MUST:
- Be exactly ONE sentence
- Have a word count BETWEEN ${minWords} and ${maxWords} words
- If too short → expand with more detail
- If too long → compress while keeping key elements

VARIATION RULES (IMPORTANT):
- Avoid repeating sentence openings
- Avoid repeating structure patterns
- Vary composition, mood, and visual elements
- If a prompt is too similar to a previous one, rewrite it

THEME: ${sanitizedTheme}
STYLE MODE: ${styleModeLabel}
`;

  // Style-specific rules
  let styleRules = '';
  
  switch (styleMode) {
    case 'free_illustration':
      styleRules = `
STYLE: FREE ILLUSTRATION
You generate cinematic scene descriptions with vivid imagery.

CONTENT RULES:
- Describe scenes naturally based on the theme
- Include atmosphere, lighting, and mood
- Use descriptive language for environments, characters, or objects
- Focus on visual storytelling and composition
- No typography or text elements required
- Can be any artistic style: photorealistic, painterly, fantasy, etc.

CHECKLIST FOR EACH PROMPT:
- Clear subject or scene
- Atmospheric lighting described
- Mood or emotion conveyed
- Artistic style or medium (optional but encouraged)
`;
      break;
      
    case 'typography':
      styleRules = `
STYLE: TYPOGRAPHY
You generate text-based visual design prompts.

CONTENT RULES:
- The subject MUST be text, letters, or typography
- Describe specific font styles (serif, sans-serif, script, display, etc.)
- Include text arrangement and composition
- Specify colors, textures, or materials for the typography
- Background should complement the text design
- No glitch effects unless specifically themed

CHECKLIST FOR EACH PROMPT:
- Typography style specified
- Text composition described
- Color palette or material
- Background or context
`;
      break;
      
    case 'glitch_typography':
      styleRules = `
STYLE: GLITCH TYPOGRAPHY
You generate text-based visuals with digital glitch effects.

NON-NEGOTIABLE CONTENT RULES:
- The subject MUST always be text or typography
- Typography MUST be affected by DIGITAL glitch effects
- Background MUST be dark or black-dominant
- No illustration-only or scenery-only prompts
- No watercolor, painterly, or soft fantasy styles

CONTENT CHECKLIST (ALL REQUIRED IN EACH PROMPT):
- Exact typography style (sans-serif, monospace, display, stencil, brutalist, etc.)
- Specific glitch behavior (RGB split, pixel tearing, scanlines, VHS noise, signal loss, data corruption, chromatic aberration)
- Dark or black background
- Color or screen-light accents
- Digital or technological mood
`;
      break;
      
    case 'ui_tech_screen':
      styleRules = `
STYLE: UI / TECH SCREEN
You generate interface-like, system message visuals.

CONTENT RULES:
- Focus on futuristic UI elements, HUDs, or system interfaces
- Include digital screens, terminals, or holographic displays
- Describe system messages, error codes, or data visualizations
- Use tech-inspired aesthetics: grids, scanlines, data streams
- Typography should look like system fonts or terminal text
- Dark backgrounds with glowing elements preferred

CHECKLIST FOR EACH PROMPT:
- Type of interface or screen
- System elements (buttons, graphs, text, indicators)
- Color scheme (neon, monochrome, holographic)
- Tech aesthetic or era (cyberpunk, retro-futuristic, minimal)
`;
      break;
  }

  if (batchNumber === 1) {
    return `${baseRules}
${styleRules}

Generate exactly ${batchSize} unique prompts.

OUTPUT FORMAT (STRICT):
Return ONLY a valid JSON array of strings.
Do NOT include markdown, code blocks, or explanations.
Example: ["prompt 1 text", "prompt 2 text"]

QUALITY CONTROL before outputting each prompt:
- Check word count is within ${minWords}-${maxWords} range
- Check style requirements are met
- Check it does not repeat structure from previous prompts

Generate ${batchSize} prompts NOW:`;
  }

  const recentPrompts = previousPrompts.slice(-5);
  return `${baseRules}
${styleRules}

Continue generating NEW prompts only.
Previous prompts ended at number ${startNumber - 1}.

Rules:
- Generate exactly ${batchSize} NEW prompts.
- Number from ${startNumber} to ${endNumber}.
- Do NOT repeat concepts, metaphors, visual ideas, or wording from previous batches.
- Maintain consistent theme and quality.
- Each prompt must be ONE sentence with ${minWords}-${maxWords} words.
- No explanations, no headers, no extra text.

Previous batch ended with these prompts (for context, DO NOT repeat or paraphrase these):
${recentPrompts.map((p, i) => `  ${i + 1}. "${p}"`).join('\n')}

OUTPUT FORMAT (STRICT):
Return ONLY a valid JSON array of ${batchSize} NEW prompt strings.
No markdown, no code blocks, no explanations.
Example: ["New prompt 1", "New prompt 2"]

Generate ${batchSize} NEW prompts NOW:`;
}

function validatePromptForStyle(prompt: string, styleMode: string, minWords: number, maxWords: number): boolean {
  const words = prompt.split(/\s+/).length;
  
  // Word count check (with tolerance)
  if (words < minWords * 0.8 || words > maxWords * 1.2) {
    return false;
  }
  
  switch (styleMode) {
    case 'glitch_typography': {
      const hasTypography = /text|typography|font|letter|character|word|glyph|type|sans-serif|monospace|serif|display|stencil/i.test(prompt);
      const hasGlitch = /glitch|pixel|scan|vhs|noise|corrupt|rgb|split|tear|distort|fragment|static|signal|digital|chromatic|aberration/i.test(prompt);
      return hasTypography && hasGlitch;
    }
    
    case 'typography': {
      const hasTypography = /text|typography|font|letter|character|word|glyph|type|sans-serif|monospace|serif|display|script|typeface/i.test(prompt);
      return hasTypography;
    }
    
    case 'ui_tech_screen': {
      const hasTech = /screen|interface|ui|hud|terminal|display|system|digital|holographic|panel|dashboard|monitor|data|grid/i.test(prompt);
      return hasTech;
    }
    
    case 'free_illustration':
    default:
      // Free illustration is more permissive
      return prompt.length > 20;
  }
}

async function generateBatch(
  apiKey: string,
  theme: string,
  styleMode: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  endNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): Promise<BatchResult> {
  const systemPrompt = buildPromptSystem(
    theme,
    styleMode,
    batchNumber,
    batchSize,
    startNumber,
    endNumber,
    minWords,
    maxWords,
    previousPrompts
  );

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate ${batchSize} ${getStyleModeLabel(styleMode)} prompts with theme: ${sanitizeTheme(theme)}` },
      ],
      temperature: 0.9,
      max_tokens: 3000,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Groq API error:", errorData);
    
    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    if (response.status === 401) {
      throw new Error("INVALID_KEY");
    }
    throw new Error("API request failed");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No response from AI model");
  }

  let prompts: string[];
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      prompts = JSON.parse(jsonMatch[0]);
    } else {
      prompts = content
        .split("\n")
        .map((line: string) => line.replace(/^\d+\.\s*/, "").replace(/^["']|["']$/g, "").trim())
        .filter((line: string) => line.length > 20);
    }
  } catch {
    prompts = content
      .split("\n")
      .map((line: string) => line.replace(/^\d+\.\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter((line: string) => line.length > 20);
  }

  // Filter and clean prompts based on style
  const cleanedPrompts = prompts
    .map((p: string) => p.trim())
    .filter((p: string) => validatePromptForStyle(p, styleMode, minWords, maxWords))
    .slice(0, batchSize);

  return {
    prompts: cleanedPrompts,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

async function generateBatchWithRotation(
  supabase: SupabaseClient,
  rotationState: KeyRotationState,
  encryptionKey: string,
  theme: string,
  styleMode: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  endNumber: number,
  minWords: number,
  maxWords: number,
  previousPrompts: string[]
): Promise<{ result: BatchResult; usedKeyId: string }> {
  let lastError: Error | null = null;
  
  const availableKeys = getAvailableKeys(rotationState.keys);
  
  if (availableKeys.length === 0) {
    throw new Error("All API keys are in cooldown. Please wait or add more keys.");
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
          theme,
          styleMode,
          model, 
          batchNumber, 
          batchSize,
          startNumber,
          endNumber,
          minWords,
          maxWords,
          previousPrompts
        );
        
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
      model, 
      styleMode = 'glitch_typography',
      outputFormat = 'json',
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

    // Validate style mode
    const validStyleMode = VALID_STYLE_MODES.includes(styleMode) ? styleMode : 'glitch_typography';
    
    // Validate output format
    const validOutputFormat = VALID_OUTPUT_FORMATS.includes(outputFormat) ? outputFormat : 'json';

    // Validate and sanitize numeric inputs
    const totalCount = Math.min(Math.max(1, Number(count) || 20), MAX_PROMPT_COUNT);
    const validMinWords = Math.min(Math.max(MIN_WORD_COUNT, Number(minWords) || 22), MAX_WORD_COUNT);
    const validMaxWords = Math.min(Math.max(validMinWords + 5, Number(maxWords) || 35), MAX_WORD_COUNT);

    const { data: keys, error: keysError } = await supabase
      .from("api_keys")
      .select("id, encrypted_key, last_used_at, cooldown_until")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (keysError || !keys || keys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active API keys found. Please add a Groq API key first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rotationState: KeyRotationState = {
      currentIndex: 0,
      keys: keys as ApiKeyRecord[],
    };

    const numBatches = Math.ceil(totalCount / BATCH_SIZE);
    console.log(`Generating ${totalCount} ${getStyleModeLabel(validStyleMode)} prompts in ${numBatches} batch(es) with ${keys.length} available key(s)`);

    const allPrompts: string[] = [];
    let totalTokensUsed = 0;

    for (let batchNum = 1; batchNum <= numBatches; batchNum++) {
      const isLastBatch = batchNum === numBatches;
      const batchSize = isLastBatch ? (totalCount - (batchNum - 1) * BATCH_SIZE) : BATCH_SIZE;
      const startNumber = (batchNum - 1) * BATCH_SIZE + 1;
      const endNumber = startNumber + batchSize - 1;
      
      console.log(`Processing batch ${batchNum}/${numBatches} (prompts ${startNumber}-${endNumber})`);

      try {
        const { result, usedKeyId } = await generateBatchWithRotation(
          supabase,
          rotationState,
          encryptionKey,
          theme,
          validStyleMode,
          model,
          batchNum,
          batchSize,
          startNumber,
          endNumber,
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
            model: model || "llama-3.3-70b-versatile",
            prompt_count: allPrompts.length,
            tokens_used: totalTokensUsed,
          } as Record<string, unknown>);

          return new Response(
            JSON.stringify({ 
              prompts: allPrompts,
              styleMode: validStyleMode,
              outputFormat: validOutputFormat,
              partial: true,
              completedBatches: batchNum - 1,
              totalBatches: numBatches,
              message: `Generated ${allPrompts.length} of ${totalCount} prompts. Some batches failed due to rate limits.`
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: "Failed to generate prompts. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    await supabase.from("prompt_logs").insert({
      user_id: user.id,
      model: model || "llama-3.3-70b-versatile",
      prompt_count: allPrompts.length,
      tokens_used: totalTokensUsed,
    } as Record<string, unknown>);

    console.log(`Generation complete: ${allPrompts.length} prompts, ${totalTokensUsed} total tokens`);

    return new Response(
      JSON.stringify({ 
        prompts: allPrompts,
        styleMode: validStyleMode,
        outputFormat: validOutputFormat,
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
