-- Remove the old CHECK constraint that only allows 'groq' provider
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_provider_check;

-- Add new CHECK constraint that allows both 'groq' and 'openrouter' providers
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_provider_check 
CHECK (provider IN ('groq', 'openrouter'));