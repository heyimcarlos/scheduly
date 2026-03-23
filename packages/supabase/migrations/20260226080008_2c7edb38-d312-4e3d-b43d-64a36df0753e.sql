
-- Restrict direct team_members SELECT to managers only
DROP POLICY "All authenticated can read team_members" ON public.team_members;

CREATE POLICY "Managers can select team_members"
ON public.team_members FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Create a safe view without email for all authenticated users
CREATE VIEW public.team_members_safe AS
SELECT id, name, initials, role, region, timezone, seniority, contract_type,
       fatigue_score, max_hours, weekly_hours, skills, avatar, created_at, updated_at
FROM public.team_members;

-- Grant access to the view for authenticated users
GRANT SELECT ON public.team_members_safe TO authenticated;
