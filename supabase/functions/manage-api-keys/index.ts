import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple XOR-based encryption for API keys
function encryptKey(key: string, secret: string): string {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(key);
  const secretBytes = encoder.encode(secret);
  const encrypted = new Uint8Array(keyBytes.length);
  
  for (let i = 0; i < keyBytes.length; i++) {
    encrypted[i] = keyBytes[i] ^ secretBytes[i % secretBytes.length];
  }
  
  return btoa(String.fromCharCode(...encrypted));
}

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

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
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

    const { action, apiKey, label, keyId } = await req.json();

    if (action === "add") {
      // Check key count
      const { count } = await supabase
        .from("api_keys")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (count && count >= 5) {
        return new Response(
          JSON.stringify({ error: "Maximum 5 API keys allowed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate the API key format
      if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("gsk_")) {
        return new Response(
          JSON.stringify({ error: "Invalid API key format. Groq keys start with 'gsk_'" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const encryptedKey = encryptKey(apiKey, encryptionKey);
      const keyHint = maskKey(apiKey);

      const { error: insertError } = await supabase
        .from("api_keys")
        .insert({
          user_id: user.id,
          encrypted_key: encryptedKey,
          key_hint: keyHint,
          label: label || null,
          provider: "groq",
          is_active: true,
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save API key" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_decrypted") {
      // Only for internal use by other edge functions
      const { data: keys, error } = await supabase
        .from("api_keys")
        .select("id, encrypted_key, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (error || !keys || keys.length === 0) {
        return new Response(
          JSON.stringify({ error: "No active API keys found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Return a random active key (simple rotation)
      const randomKey = keys[Math.floor(Math.random() * keys.length)];
      const decryptedKey = decryptKey(randomKey.encrypted_key, encryptionKey);

      return new Response(
        JSON.stringify({ apiKey: decryptedKey, keyId: randomKey.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
