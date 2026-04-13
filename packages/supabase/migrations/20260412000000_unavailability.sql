-- 1. Add status column to shifts
ALTER TABLE public.shifts
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- 2. Create unavailability_plans
CREATE TABLE public.unavailability_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_profile_id UUID NOT NULL REFERENCES public.team_profiles(id) ON DELETE CASCADE,
  absent_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed | cancelled
  cascade_depth_limit INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unavailability_plans_team_profile
  ON public.unavailability_plans(team_profile_id);
CREATE INDEX idx_unavailability_plans_absent_member
  ON public.unavailability_plans(absent_member_id);

-- 3. Create unavailability_days
CREATE TABLE public.unavailability_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.unavailability_plans(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  original_shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  coverage_shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  approved_member_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | skipped | no_gap | needs_manual
  cascade_depth INT NOT NULL DEFAULT 0,
  recommendations JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unavailability_days_plan
  ON public.unavailability_days(plan_id);

-- 4. RLS policies (follow existing pattern from team_profile_ownership migration)
ALTER TABLE public.unavailability_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unavailability_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage unavailability_plans"
  ON public.unavailability_plans
  FOR ALL
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can manage unavailability_days"
  ON public.unavailability_days
  FOR ALL
  USING (
    plan_id IN (
      SELECT up.id FROM public.unavailability_plans up
      JOIN public.team_profiles tp ON up.team_profile_id = tp.id
      WHERE tp.owner_user_id = auth.uid()
    )
  );
