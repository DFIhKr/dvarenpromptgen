import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptKey, maskKey } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROVIDER_CONFIGS = {
  groq: {
    prefix: 'gsk_',
    name: 'Groq',
    minLength: 20,
    maxLength: 200,
  },
  openrouter: {
    prefix: 'sk-or-',
    name: 'OpenRouter',
    minLength: 20,
    maxLength: 200,
  },
  gemini: {
    prefix: 'AIza',
    name: 'Gemini',
    minLength: 20,
    maxLength: 200,
  },
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

    const { action, apiKey, provider = 'groq', label } = await req.json();

    const validActions = ["add", "get_decrypted", "list", "delete", "toggle"];
    if (!action || typeof action !== "string" || !validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "add") {
      const validProviders = ['groq', 'openrouter', 'gemini'];
      if (!validProviders.includes(provider)) {
        return new Response(
          JSON.stringify({ error: "Invalid provider. Must be 'groq', 'openrouter', or 'gemini'" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const providerConfig = PROVIDER_CONFIGS[provider as keyof typeof PROVIDER_CONFIGS];

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

      if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith(providerConfig.prefix)) {
        return new Response(
          JSON.stringify({ error: `Invalid API key format. ${providerConfig.name} keys start with '${providerConfig.prefix}'` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (apiKey.length < providerConfig.minLength || apiKey.length > providerConfig.maxLength) {
        return new Response(
          JSON.stringify({ error: "Invalid API key length" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sanitizedLabel = label
        ? String(label).slice(0, 50).replace(/[<>&"']/g, '')
        : null;

      const encryptedKey = await encryptKey(apiKey, encryptionKey);
      const keyHint = maskKey(apiKey);

      const { error: insertError } = await supabase
        .from("api_keys")
        .insert({
          user_id: user.id,
          encrypted_key: encryptedKey,
          key_hint: keyHint,
          label: sanitizedLabel,
          provider: provider,
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
      const { data: keys, error } = await supabase
        .from("api_keys")
        .select("id, encrypted_key, provider, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (error || !keys || keys.length === 0) {
        return new Response(
          JSON.stringify({ error: "No active API keys found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ keys }),
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
