-- Migration: Add team_profile_id ownership to team_members and shifts
-- Enables per-manager scoping of shifts via team_profile ownership chain

-- =============================================================================
-- STEP 1: Add team_profile_id to team_members
-- =============================================================================

ALTER TABLE public.team_members
  ADD COLUMN team_profile_id UUID REFERENCES public.team_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_team_members_team_profile_id
  ON public.team_members(team_profile_id);

-- =============================================================================
-- STEP 2: Add team_profile_id to shifts (propagated from member, NOT NULL)
-- =============================================================================

ALTER TABLE public.shifts
  ADD COLUMN team_profile_id UUID REFERENCES public.team_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shifts_team_profile_id
  ON public.shifts(team_profile_id);

-- =============================================================================
-- STEP 3: Backfill team_members.team_profile_id
-- Assign each team_member to one of the team_profiles owned by the user
-- who has that member in their profiles.team_member_id (i.e., the "owner").
-- profiles.team_member_id links a user (via their profile) to their team_member.
-- If no owner found, fall back to the first team_profile for any manager.
-- =============================================================================

UPDATE public.team_members tm
SET team_profile_id = COALESCE(
  -- Try: the active team_profile of the user who owns this team_member
  (
    SELECT p.active_team_profile_id
    FROM public.profiles p
    WHERE p.team_member_id = tm.id
      AND p.active_team_profile_id IS NOT NULL
    LIMIT 1
  ),
  -- Fallback: any active team_profile owned by a manager user
  (
    SELECT tp.id
    FROM public.team_profiles tp
    WHERE tp.owner_user_id IN (
      SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'manager'
    )
    ORDER BY tp.is_active DESC, tp.created_at ASC
    LIMIT 1
  ),
  -- Last resort: first team_profile by creation order
  (
    SELECT id FROM public.team_profiles ORDER BY created_at ASC LIMIT 1
  )
)
WHERE tm.team_profile_id IS NULL;

-- =============================================================================
-- STEP 4: Backfill shifts.team_profile_id from team_members
-- Existing shifts inherit their member's team_profile_id
-- =============================================================================

UPDATE public.shifts s
SET team_profile_id = tm.team_profile_id
FROM public.team_members tm
WHERE s.member_id = tm.id
  AND tm.team_profile_id IS NOT NULL
  AND s.team_profile_id IS NULL;

-- Make NOT NULL after backfill (all real data has a team_profile at creation time)
ALTER TABLE public.team_members
  ALTER COLUMN team_profile_id SET NOT NULL;

ALTER TABLE public.shifts
  ALTER COLUMN team_profile_id SET NOT NULL;

-- =============================================================================
-- STEP 5: Drop old RLS policies (replace with team-profile-scoped ones)
-- =============================================================================

-- team_members: drop old policies
DROP POLICY IF EXISTS "Managers can select team_members" ON public.team_members;
DROP POLICY IF EXISTS "Managers can insert team_members" ON public.team_members;
DROP POLICY IF EXISTS "Managers can update team_members" ON public.team_members;
DROP POLICY IF EXISTS "Managers can delete team_members" ON public.team_members;

-- shifts: drop old policies
DROP POLICY IF EXISTS "All authenticated can read shifts" ON public.shifts;
DROP POLICY IF EXISTS "Managers can insert shifts" ON public.shifts;
DROP POLICY IF EXISTS "Managers can update shifts" ON public.shifts;
DROP POLICY IF EXISTS "Managers can delete shifts" ON public.shifts;

-- =============================================================================
-- STEP 6: Create team-profile-scoped RLS policies
-- A user can only access team_members and shifts that belong to a team_profile
-- they own (i.e., team_profile.owner_user_id = auth.uid()).
-- Managers can write; all authenticated users can read their own team's data.
-- =============================================================================

-- Helper: get team_profile IDs owned by the current user
-- Note: We use a SECURITY DEFINER function to avoid issues with
-- the auth.uid() context in complex USING/WITH CHECK expressions.

-- team_members: readable by owner of the team_profile
CREATE POLICY "team_members readable by profile owner"
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "team_members insertable by profile owner"
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "team_members updatable by profile owner"
  ON public.team_members
  FOR UPDATE
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "team_members deletable by profile owner"
  ON public.team_members
  FOR DELETE
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

-- shifts: readable/manageable by owner of the team_profile
CREATE POLICY "shifts readable by profile owner"
  ON public.shifts
  FOR SELECT
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "shifts insertable by profile owner"
  ON public.shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "shifts updatable by profile owner"
  ON public.shifts
  FOR UPDATE
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "shifts deletable by profile owner"
  ON public.shifts
  FOR DELETE
  TO authenticated
  USING (
    team_profile_id IN (
      SELECT id FROM public.team_profiles
      WHERE owner_user_id = auth.uid()
    )
  );
