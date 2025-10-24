-- Add classification_prompt_settings column to user_preferences table
-- This stores custom OpenAI classification prompt settings per user

ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS classification_prompt_settings jsonb DEFAULT NULL;

COMMENT ON COLUMN public.user_preferences.classification_prompt_settings IS 'Custom OpenAI classification prompt settings (model, temperature, maxLabels, etc.)';
