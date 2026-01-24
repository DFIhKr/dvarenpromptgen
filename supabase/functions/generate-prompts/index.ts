import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Try keys with rotation until one works
    let lastError: string | null = null;
    const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

    for (const keyRecord of shuffledKeys) {
      try {
        const apiKey = decryptKey(keyRecord.encrypted_key, encryptionKey);

        const promptCount = Math.min(Math.max(1, count), 20);
        
        const systemPrompt = `You are a creative prompt generator. Generate exactly ${promptCount} unique, creative, and actionable prompts based on the user's topic. 
Return ONLY a JSON array of strings, each string being one prompt. No explanations, no numbering in the prompts, just the pure prompts.
Example format: ["Prompt 1 text here", "Prompt 2 text here"]`;

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
              { role: "user", content: `Generate ${promptCount} creative prompts about: ${topic}` },
            ],
            temperature: 0.8,
            max_tokens: 2000,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error("Groq API error:", errorData);
          
          if (response.status === 429) {
            lastError = "Rate limit reached. Trying another key...";
            continue; // Try next key
          }
          
          if (response.status === 401) {
            lastError = "Invalid API key. Please check your Groq API key.";
            continue; // Try next key
          }
          
          lastError = errorData.error?.message || "Failed to generate prompts";
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          lastError = "No response from AI model";
          continue;
        }

        // Parse the JSON response
        let prompts: string[];
        try {
          // Try to extract JSON from the response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            prompts = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback: split by newlines and clean up
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

        // Log usage
        await supabase.from("prompt_logs").insert({
          user_id: user.id,
          model: model || "llama-3.3-70b-versatile",
          prompt_count: prompts.length,
          tokens_used: data.usage?.total_tokens || null,
        });

        return new Response(
          JSON.stringify({ prompts }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Key attempt error:", error);
        lastError = error instanceof Error ? error.message : "Unknown error";
        continue;
      }
    }

    // All keys failed
    return new Response(
      JSON.stringify({ error: lastError || "All API keys failed. Please check your keys." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
