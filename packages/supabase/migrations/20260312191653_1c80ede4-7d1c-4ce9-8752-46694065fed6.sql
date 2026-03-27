
-- Create team_profiles table
CREATE TABLE public.team_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_key text,
  config jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own team_profiles" ON public.team_profiles
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "Owner can insert own team_profiles" ON public.team_profiles
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "Owner can update own team_profiles" ON public.team_profiles
  FOR UPDATE TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "Owner can delete own team_profiles" ON public.team_profiles
  FOR DELETE TO authenticated USING (owner_user_id = auth.uid());

CREATE TRIGGER update_team_profiles_updated_at
  BEFORE UPDATE ON public.team_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Alter profiles table
ALTER TABLE public.profiles
  ADD COLUMN active_team_profile_id uuid REFERENCES public.team_profiles(id),
  ADD COLUMN onboarding_completed_at timestamptz;
