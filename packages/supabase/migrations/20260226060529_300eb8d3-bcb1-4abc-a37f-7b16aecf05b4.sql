
-- Drop existing overly permissive policies on team_members
DROP POLICY IF EXISTS "Authenticated read team_members" ON public.team_members;
DROP POLICY IF EXISTS "Authenticated insert team_members" ON public.team_members;
DROP POLICY IF EXISTS "Authenticated update team_members" ON public.team_members;
DROP POLICY IF EXISTS "Authenticated delete team_members" ON public.team_members;

-- Drop existing overly permissive policies on shifts
DROP POLICY IF EXISTS "Authenticated read shifts" ON public.shifts;
DROP POLICY IF EXISTS "Authenticated insert shifts" ON public.shifts;
DROP POLICY IF EXISTS "Authenticated update shifts" ON public.shifts;
DROP POLICY IF EXISTS "Authenticated delete shifts" ON public.shifts;

-- Drop existing overly permissive policies on holidays
DROP POLICY IF EXISTS "Authenticated read holidays" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated delete holidays" ON public.holidays;

-- Drop existing overly permissive policies on ai_suggestions
DROP POLICY IF EXISTS "Authenticated read ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Authenticated insert ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Authenticated update ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Authenticated delete ai_suggestions" ON public.ai_suggestions;

-- team_members: all authenticated can read, only managers can write
CREATE POLICY "All authenticated can read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert team_members" ON public.team_members FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update team_members" ON public.team_members FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can delete team_members" ON public.team_members FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- shifts: all authenticated can read, only managers can write
CREATE POLICY "All authenticated can read shifts" ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert shifts" ON public.shifts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update shifts" ON public.shifts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can delete shifts" ON public.shifts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- holidays: all authenticated can read, only managers can write
CREATE POLICY "All authenticated can read holidays" ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert holidays" ON public.holidays FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update holidays" ON public.holidays FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can delete holidays" ON public.holidays FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- ai_suggestions: all authenticated can read, only managers can write
CREATE POLICY "All authenticated can read ai_suggestions" ON public.ai_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert ai_suggestions" ON public.ai_suggestions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update ai_suggestions" ON public.ai_suggestions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can delete ai_suggestions" ON public.ai_suggestions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));
