-- Add columns for key rotation tracking
ALTER TABLE public.api_keys 
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP WITH TIME ZONE;

-- Create index for efficient key selection during rotation
CREATE INDEX IF NOT EXISTS idx_api_keys_rotation 
ON public.api_keys (user_id, is_active, cooldown_until, last_used_at);