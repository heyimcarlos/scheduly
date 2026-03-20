
-- Phase 1.2: Create time_off_requests table
CREATE TABLE public.time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  team_member_id uuid REFERENCES public.team_members(id) ON DELETE CASCADE NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('day_off', 'sick_day', 'vacation', 'partial_availability', 'shift_swap')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  partial_start time,
  partial_end time,
  swap_target_shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  manager_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

-- Employees can read own requests
CREATE POLICY "Users can read own requests"
  ON public.time_off_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Employees can insert own requests
CREATE POLICY "Users can insert own requests"
  ON public.time_off_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Employees can update own pending requests
CREATE POLICY "Users can update own pending requests"
  ON public.time_off_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- Employees can delete own pending requests
CREATE POLICY "Users can delete own pending requests"
  ON public.time_off_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- Managers can read all requests
CREATE POLICY "Managers can read all requests"
  ON public.time_off_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- Managers can update all requests (approve/reject)
CREATE POLICY "Managers can update all requests"
  ON public.time_off_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- Phase 1.3: Add columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS availability_preferences text,
  ADD COLUMN IF NOT EXISTS team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL;

-- Managers can read all profiles
CREATE POLICY "Managers can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- Phase 1.4: Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- Storage RLS: users can upload own avatar
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- Trigger for updated_at on time_off_requests
CREATE TRIGGER update_time_off_requests_updated_at
  BEFORE UPDATE ON public.time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
