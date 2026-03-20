
-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Only admins can manage roles
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Users can read their own roles
CREATE POLICY "Users can read own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Auto-assign 'user' role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Update existing table RLS: replace public policies with authenticated-only

-- team_members
DROP POLICY IF EXISTS "Allow public read team_members" ON public.team_members;
DROP POLICY IF EXISTS "Allow public insert team_members" ON public.team_members;
DROP POLICY IF EXISTS "Allow public update team_members" ON public.team_members;
DROP POLICY IF EXISTS "Allow public delete team_members" ON public.team_members;

CREATE POLICY "Authenticated read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert team_members" ON public.team_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update team_members" ON public.team_members FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete team_members" ON public.team_members FOR DELETE TO authenticated USING (true);

-- shifts
DROP POLICY IF EXISTS "Allow public read shifts" ON public.shifts;
DROP POLICY IF EXISTS "Allow public insert shifts" ON public.shifts;
DROP POLICY IF EXISTS "Allow public update shifts" ON public.shifts;
DROP POLICY IF EXISTS "Allow public delete shifts" ON public.shifts;

CREATE POLICY "Authenticated read shifts" ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert shifts" ON public.shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update shifts" ON public.shifts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete shifts" ON public.shifts FOR DELETE TO authenticated USING (true);

-- holidays
DROP POLICY IF EXISTS "Allow public read holidays" ON public.holidays;
DROP POLICY IF EXISTS "Allow public insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Allow public update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Allow public delete holidays" ON public.holidays;

CREATE POLICY "Authenticated read holidays" ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert holidays" ON public.holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update holidays" ON public.holidays FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete holidays" ON public.holidays FOR DELETE TO authenticated USING (true);

-- ai_suggestions
DROP POLICY IF EXISTS "Allow public read ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Allow public insert ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Allow public update ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Allow public delete ai_suggestions" ON public.ai_suggestions;

CREATE POLICY "Authenticated read ai_suggestions" ON public.ai_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert ai_suggestions" ON public.ai_suggestions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update ai_suggestions" ON public.ai_suggestions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete ai_suggestions" ON public.ai_suggestions FOR DELETE TO authenticated USING (true);

-- Add updated_at trigger for profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
