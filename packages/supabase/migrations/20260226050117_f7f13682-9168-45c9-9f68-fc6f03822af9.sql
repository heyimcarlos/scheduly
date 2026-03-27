
-- Create team_members table
CREATE TABLE public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('canada', 'india', 'serbia')),
  role TEXT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  fatigue_score INTEGER NOT NULL DEFAULT 0,
  avatar TEXT,
  seniority TEXT NOT NULL CHECK (seniority IN ('senior', 'junior')),
  weekly_hours INTEGER,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('full-time', 'part-time', 'contract')),
  max_hours INTEGER NOT NULL DEFAULT 40,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create shifts table
CREATE TABLE public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  is_pending BOOLEAN NOT NULL DEFAULT false,
  is_conflict BOOLEAN NOT NULL DEFAULT false,
  is_high_fatigue BOOLEAN NOT NULL DEFAULT false,
  is_efficient BOOLEAN NOT NULL DEFAULT false,
  title TEXT,
  shift_type TEXT NOT NULL DEFAULT 'regular' CHECK (shift_type IN ('regular', 'sick', 'vacation', 'absent')),
  has_rest_violation BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create holidays table
CREATE TABLE public.holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('canada', 'india', 'serbia')),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_suggestions table
CREATE TABLE public.ai_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('redistribute', 'swap', 'coverage', 'fatigue')),
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  affected_members TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Public read/write policies (no auth required for this admin tool)
CREATE POLICY "Allow public read team_members" ON public.team_members FOR SELECT USING (true);
CREATE POLICY "Allow public insert team_members" ON public.team_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update team_members" ON public.team_members FOR UPDATE USING (true);
CREATE POLICY "Allow public delete team_members" ON public.team_members FOR DELETE USING (true);

CREATE POLICY "Allow public read shifts" ON public.shifts FOR SELECT USING (true);
CREATE POLICY "Allow public insert shifts" ON public.shifts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update shifts" ON public.shifts FOR UPDATE USING (true);
CREATE POLICY "Allow public delete shifts" ON public.shifts FOR DELETE USING (true);

CREATE POLICY "Allow public read holidays" ON public.holidays FOR SELECT USING (true);
CREATE POLICY "Allow public insert holidays" ON public.holidays FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update holidays" ON public.holidays FOR UPDATE USING (true);
CREATE POLICY "Allow public delete holidays" ON public.holidays FOR DELETE USING (true);

CREATE POLICY "Allow public read ai_suggestions" ON public.ai_suggestions FOR SELECT USING (true);
CREATE POLICY "Allow public insert ai_suggestions" ON public.ai_suggestions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update ai_suggestions" ON public.ai_suggestions FOR UPDATE USING (true);
CREATE POLICY "Allow public delete ai_suggestions" ON public.ai_suggestions FOR DELETE USING (true);

-- Timestamp update function and triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
