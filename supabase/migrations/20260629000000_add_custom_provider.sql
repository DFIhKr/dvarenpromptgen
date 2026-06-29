ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_provider_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_provider_check 
  CHECK (provider IN ('groq', 'openrouter', 'gemini', 'nvidia', '9router', 'custom'));
