import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptKey, decryptKeyWithFallback, maskKey } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { action, apiKey, label } = await req.json();

    // Validate action parameter
    const validActions = ["add", "get_decrypted", "list", "delete", "toggle"];
    if (!action || typeof action !== "string" || !validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      // Validate API key length (Groq keys are typically 50+ characters)
      if (apiKey.length < 20 || apiKey.length > 200) {
        return new Response(
          JSON.stringify({ error: "Invalid API key length" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate label if provided
      const sanitizedLabel = label 
        ? String(label).slice(0, 50).replace(/[<>&"']/g, '') 
        : null;

      // Encrypt with AES-256-GCM
      const encryptedKey = await encryptKey(apiKey, encryptionKey);
      const keyHint = maskKey(apiKey);

      const { error: insertError } = await supabase
        .from("api_keys")
        .insert({
          user_id: user.id,
          encrypted_key: encryptedKey,
          key_hint: keyHint,
          label: sanitizedLabel,
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
      
      // Use fallback decryption to support both old XOR and new AES-GCM keys
      const decryptedKey = await decryptKeyWithFallback(randomKey.encrypted_key, encryptionKey);

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
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
