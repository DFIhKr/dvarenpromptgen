import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1200; // 1.2 seconds between batches
const MAX_RETRIES = 2;
const COOLDOWN_DURATION_MS = 60000; // 60 seconds cooldown for rate-limited keys

function decryptKey(encrypted: string, secret: string): string {
  const decoder = new TextDecoder();
  const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const secretBytes = new TextEncoder().encode(secret);
  const decrypted = new Uint8Array(encryptedBytes.length);
  
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ secretBytes[i % secretBytes.length];
  }
  
  return decoder.decode(decrypted);
}

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

// Get available keys sorted for round-robin (oldest used first)
function getAvailableKeys(keys: ApiKeyRecord[]): ApiKeyRecord[] {
  const now = new Date();
  
  return keys
    .filter(key => {
      // Exclude keys currently in cooldown
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
      // Sort by last_used_at ascending (oldest first = round-robin)
      const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
      const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
      return aTime - bTime;
    });
}

async function generateBatch(
  apiKey: string,
  topic: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  endNumber: number,
  previousPrompts: string[]
): Promise<BatchResult> {
  let systemPrompt: string;
  
  if (batchNumber === 1) {
    systemPrompt = `You are a creative prompt generator. Generate exactly ${batchSize} unique, creative, and actionable prompts based on the user's topic.
Return ONLY a JSON array of strings, each string being one prompt. No explanations, no numbering in the prompts, just the pure prompts.
Example format: ["Prompt 1 text here", "Prompt 2 text here"]
IMPORTANT: Generate exactly ${batchSize} prompts, no more, no less.`;
  } else {
    // Continuation prompt with context from previous batches
    const recentPrompts = previousPrompts.slice(-5); // Last 5 prompts for context
    systemPrompt = `You are a creative prompt generator continuing a series.

Continue generating NEW text-to-image prompts only.
Previous prompts ended at number ${startNumber - 1}.

Rules:
- Generate exactly ${batchSize} NEW prompts.
- Number from ${startNumber} to ${endNumber}.
- Do NOT repeat concepts, metaphors, visual ideas, or wording from previous batches.
- Maintain consistent theme and quality.
- Each prompt must be ONE sentence.
- No explanations, no headers, no extra text.

Previous batch ended with these prompts (for context, DO NOT repeat or paraphrase these):
${recentPrompts.map((p, i) => `  ${i + 1}. "${p}"`).join('\n')}

Return ONLY a JSON array of ${batchSize} NEW prompt strings. No explanations, no numbering.
Example format: ["New prompt 1", "New prompt 2"]`;
  }

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
        { role: "user", content: `Generate ${batchSize} creative prompts about: ${topic}` },
      ],
      temperature: 0.85,
      max_tokens: 2500,
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
    throw new Error(errorData.error?.message || "API request failed");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No response from AI model");
  }

  // Parse the JSON response
  let prompts: string[];
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      prompts = JSON.parse(jsonMatch[0]);
    } else {
      prompts = content
        .split("\n")
        .map((line: string) => line.replace(/^\d+\.\s*/, "").trim())
        .filter((line: string) => line.length > 10);
    }
  } catch {
    prompts = content
      .split("\n")
      .map((line: string) => line.replace(/^\d+\.\s*/, "").trim())
      .filter((line: string) => line.length > 10);
  }

  return {
    prompts: prompts.slice(0, batchSize),
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

async function generateBatchWithRotation(
  supabase: SupabaseClient,
  rotationState: KeyRotationState,
  encryptionKey: string,
  topic: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  startNumber: number,
  endNumber: number,
  previousPrompts: string[]
): Promise<{ result: BatchResult; usedKeyId: string }> {
  let lastError: Error | null = null;
  
  // Get available keys sorted by last_used_at (round-robin)
  const availableKeys = getAvailableKeys(rotationState.keys);
  
  if (availableKeys.length === 0) {
    throw new Error("All API keys are in cooldown. Please wait or add more keys.");
  }

  for (const keyRecord of availableKeys) {
    const apiKey = decryptKey(keyRecord.encrypted_key, encryptionKey);
    
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        if (retry > 0) {
          console.log(`Retry ${retry} for batch ${batchNumber} with key ${keyRecord.id.slice(0, 8)}`);
          await delay(BATCH_DELAY_MS * (retry + 1));
        }
        
        const result = await generateBatch(
          apiKey, 
          topic, 
          model, 
          batchNumber, 
          batchSize,
          startNumber,
          endNumber,
          previousPrompts
        );
        
        // Update last_used_at and clear any cooldown
        await supabase
          .from("api_keys")
          .update({ 
            last_used_at: new Date().toISOString(),
            cooldown_until: null 
          } as Record<string, unknown>)
          .eq("id", keyRecord.id);
        
        // Update local state
        keyRecord.last_used_at = new Date().toISOString();
        keyRecord.cooldown_until = null;
        
        return { result, usedKeyId: keyRecord.id };
      } catch (error) {
        lastError = error as Error;
        console.error(`Batch ${batchNumber}, key ${keyRecord.id.slice(0, 8)}, retry ${retry}:`, error);
        
        if ((error as Error).message === "RATE_LIMIT") {
          // Set cooldown for this key and try next key
          const cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS).toISOString();
          
          await supabase
            .from("api_keys")
            .update({ cooldown_until: cooldownUntil } as Record<string, unknown>)
            .eq("id", keyRecord.id);
          
          // Update local state
          keyRecord.cooldown_until = cooldownUntil;
          
          console.log(`Key ${keyRecord.id.slice(0, 8)} set to cooldown until ${cooldownUntil}`);
          break; // Try next key
        }
        
        if ((error as Error).message === "INVALID_KEY") {
          // Mark key as inactive
          await supabase
            .from("api_keys")
            .update({ is_active: false } as Record<string, unknown>)
            .eq("id", keyRecord.id);
          
          console.log(`Key ${keyRecord.id.slice(0, 8)} marked as inactive (invalid)`);
          break; // Try next key
        }
        // For other errors, retry with same key
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

    const { topic, model, count = 5 } = await req.json();

    if (!topic || typeof topic !== "string") {
      return new Response(
        JSON.stringify({ error: "Topic is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate count (1-1000)
    const totalCount = Math.min(Math.max(1, count), 1000);

    // Get user's active API keys with rotation metadata
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

    // Initialize rotation state
    const rotationState: KeyRotationState = {
      currentIndex: 0,
      keys: keys as ApiKeyRecord[],
    };

    // Calculate batches
    const numBatches = Math.ceil(totalCount / BATCH_SIZE);
    console.log(`Generating ${totalCount} prompts in ${numBatches} batch(es) with ${keys.length} available key(s)`);

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
          topic,
          model,
          batchNum,
          batchSize,
          startNumber,
          endNumber,
          allPrompts
        );

        allPrompts.push(...result.prompts);
        totalTokensUsed += result.tokensUsed;

        console.log(`Batch ${batchNum} complete: ${result.prompts.length} prompts, ${result.tokensUsed} tokens, key ${usedKeyId.slice(0, 8)}`);

        // Add delay between batches (except after last batch)
        if (!isLastBatch) {
          await delay(BATCH_DELAY_MS);
        }
      } catch (error) {
        console.error(`Batch ${batchNum} failed:`, error);
        
        // If we have some prompts, return partial results
        if (allPrompts.length > 0) {
          console.log(`Returning partial results: ${allPrompts.length} prompts`);
          
          // Log partial usage
          await supabase.from("prompt_logs").insert({
            user_id: user.id,
            model: model || "llama-3.3-70b-versatile",
            prompt_count: allPrompts.length,
            tokens_used: totalTokensUsed,
          } as Record<string, unknown>);

          return new Response(
            JSON.stringify({ 
              prompts: allPrompts,
              partial: true,
              completedBatches: batchNum - 1,
              totalBatches: numBatches,
              message: `Generated ${allPrompts.length} of ${totalCount} prompts. Some batches failed due to rate limits.`
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // No prompts generated at all
        return new Response(
          JSON.stringify({ error: (error as Error).message || "Failed to generate prompts" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Log complete usage
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
        totalBatches: numBatches,
        completedBatches: numBatches
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
