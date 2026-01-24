import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1200; // 1.2 seconds between batches
const MAX_RETRIES = 2;

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

interface BatchResult {
  prompts: string[];
  tokensUsed: number;
}

async function generateBatch(
  apiKey: string,
  topic: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  previousPrompts: string[]
): Promise<BatchResult> {
  const startNumber = (batchNumber - 1) * BATCH_SIZE + 1;
  const endNumber = startNumber + batchSize - 1;
  
  let systemPrompt: string;
  
  if (batchNumber === 1) {
    systemPrompt = `You are a creative prompt generator. Generate exactly ${batchSize} unique, creative, and actionable prompts based on the user's topic.
Return ONLY a JSON array of strings, each string being one prompt. No explanations, no numbering in the prompts, just the pure prompts.
Example format: ["Prompt 1 text here", "Prompt 2 text here"]
IMPORTANT: Generate exactly ${batchSize} prompts, no more, no less.`;
  } else {
    // Continuation prompt with context from previous batches
    const recentPrompts = previousPrompts.slice(-5); // Last 5 prompts for context
    systemPrompt = `You are a creative prompt generator continuing a series. Generate exactly ${batchSize} NEW and UNIQUE prompts based on the user's topic.

CRITICAL INSTRUCTIONS:
- This is batch ${batchNumber} (prompts ${startNumber} to ${endNumber})
- You MUST generate completely NEW prompts that are DIFFERENT from previous ones
- Previous batch ended with these prompts (for context, DO NOT repeat or paraphrase these):
${recentPrompts.map((p, i) => `  ${i + 1}. "${p}"`).join('\n')}

Return ONLY a JSON array of ${batchSize} NEW prompt strings. No explanations, no numbering.
Example format: ["New prompt 1", "New prompt 2"]
IMPORTANT: Generate exactly ${batchSize} NEW prompts. Do NOT repeat concepts from previous prompts.`;
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
      temperature: 0.85, // Slightly higher for more variety
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
    prompts: prompts.slice(0, batchSize), // Ensure we don't exceed batch size
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

async function generateBatchWithRetry(
  apiKeys: { id: string; encrypted_key: string }[],
  encryptionKey: string,
  topic: string,
  model: string,
  batchNumber: number,
  batchSize: number,
  previousPrompts: string[],
  usedKeyIndices: Set<number>
): Promise<{ result: BatchResult; keyIndex: number }> {
  let lastError: Error | null = null;
  
  // Shuffle keys for load balancing
  const keyIndices = Array.from({ length: apiKeys.length }, (_, i) => i)
    .filter(i => !usedKeyIndices.has(i))
    .sort(() => Math.random() - 0.5);
  
  // Add already used keys at the end as fallback
  const fallbackIndices = Array.from(usedKeyIndices).sort(() => Math.random() - 0.5);
  const orderedIndices = [...keyIndices, ...fallbackIndices];

  for (const keyIndex of orderedIndices) {
    const keyRecord = apiKeys[keyIndex];
    const apiKey = decryptKey(keyRecord.encrypted_key, encryptionKey);
    
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        if (retry > 0) {
          console.log(`Retry ${retry} for batch ${batchNumber} with key ${keyIndex}`);
          await delay(BATCH_DELAY_MS * (retry + 1)); // Exponential backoff
        }
        
        const result = await generateBatch(apiKey, topic, model, batchNumber, batchSize, previousPrompts);
        return { result, keyIndex };
      } catch (error) {
        lastError = error as Error;
        console.error(`Batch ${batchNumber}, key ${keyIndex}, retry ${retry}:`, error);
        
        if ((error as Error).message === "RATE_LIMIT") {
          // Try next key immediately for rate limits
          break;
        }
        if ((error as Error).message === "INVALID_KEY") {
          // Try next key for invalid keys
          break;
        }
        // For other errors, retry with same key
      }
    }
  }
  
  throw lastError || new Error("All keys exhausted");
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

    // Validate count (1-100)
    const totalCount = Math.min(Math.max(1, count), 100);

    // Get user's active API keys
    const { data: keys, error: keysError } = await supabase
      .from("api_keys")
      .select("id, encrypted_key")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (keysError || !keys || keys.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active API keys found. Please add a Groq API key first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate batches
    const numBatches = Math.ceil(totalCount / BATCH_SIZE);
    console.log(`Generating ${totalCount} prompts in ${numBatches} batch(es)`);

    const allPrompts: string[] = [];
    let totalTokensUsed = 0;
    const usedKeyIndices = new Set<number>();

    for (let batchNum = 1; batchNum <= numBatches; batchNum++) {
      const isLastBatch = batchNum === numBatches;
      const batchSize = isLastBatch ? (totalCount - (batchNum - 1) * BATCH_SIZE) : BATCH_SIZE;
      
      console.log(`Processing batch ${batchNum}/${numBatches} (${batchSize} prompts)`);

      try {
        const { result, keyIndex } = await generateBatchWithRetry(
          keys,
          encryptionKey,
          topic,
          model,
          batchNum,
          batchSize,
          allPrompts,
          usedKeyIndices
        );

        allPrompts.push(...result.prompts);
        totalTokensUsed += result.tokensUsed;
        usedKeyIndices.add(keyIndex);

        console.log(`Batch ${batchNum} complete: ${result.prompts.length} prompts, ${result.tokensUsed} tokens`);

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
          });

          return new Response(
            JSON.stringify({ 
              prompts: allPrompts,
              partial: true,
              message: `Generated ${allPrompts.length} of ${totalCount} prompts. Some batches failed.`
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
    });

    console.log(`Generation complete: ${allPrompts.length} prompts, ${totalTokensUsed} total tokens`);

    return new Response(
      JSON.stringify({ prompts: allPrompts }),
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
