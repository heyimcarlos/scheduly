-- Migration: Add regions table and template_registry for onboarding
-- Enables dynamic region selection and template system

-- Regions table: stores all available regions (predefined + custom)
CREATE TABLE IF NOT EXISTS regions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  utc_offset    NUMERIC NOT NULL,
  dst_config    JSONB,
  color         TEXT NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Template registry table: stores team profile templates (future migration target)
CREATE TABLE IF NOT EXISTS template_registry (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  canonical_slots INTEGER DEFAULT 0,
  default_regions JSONB DEFAULT '[]',
  slot_policies JSONB DEFAULT '{}',
  rules         JSONB,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Seed predefined regions from system_config.json
INSERT INTO regions (id, name, prefix, timezone, utc_offset, dst_config, color) VALUES
  (
    'canada',
    'Canada',
    'CAN',
    'America/Toronto',
    -5,
    jsonb_build_object(
      'start_month', 3,
      'start_day', 'second_sunday',
      'end_month', 11,
      'end_day', 'first_sunday',
      'offset', -4
    ),
    'hsl(var(--team-canada))'
  ),
  (
    'serbia',
    'Serbia',
    'SRB',
    'Europe/Belgrade',
    1,
    jsonb_build_object(
      'start_month', 3,
      'start_day', 'last_sunday',
      'end_month', 10,
      'end_day', 'last_sunday',
      'offset', 2
    ),
    'hsl(var(--team-serbia))'
  ),
  (
    'india',
    'India',
    'IND',
    'Asia/Kolkata',
    5.5,
    NULL,
    'hsl(var(--team-india))'
  )
ON CONFLICT (id) DO NOTHING;

-- Seed follow_the_sun_support template
INSERT INTO template_registry (id, name, description, canonical_slots, default_regions, slot_policies, rules) VALUES
  (
    'follow_the_sun_support',
    'Follow-the-Sun Support',
    'Multi-region coverage with hand-off slots across time zones. Ideal for 24/7 support teams spanning Canada, Serbia, and India.',
    5,
    '["canada", "serbia", "india"]'::jsonb,
    '{
      "Hybrid1":  { "coverage_label": "Serbia Hybrid Opener",  "coverage_role": "serbia_hybrid",     "allowed_regions": ["Serbia", "India"], "preferred_regions": ["Serbia"],             "patch_regions": ["India"],             "fallback_penalty": 30,  "patch_penalty": 90,  "canonical": true,  "max_headcount": 1, "min_headcount": 1 },
      "Morning1": { "coverage_label": "Canada Day Early",       "coverage_role": "canada_day",          "allowed_regions": ["Canada"],            "preferred_regions": ["Canada"] },
      "Morning2": { "coverage_label": "Canada Day Core",        "coverage_role": "canada_day",          "allowed_regions": ["Canada", "Serbia"], "preferred_regions": ["Canada"],             "fallback_penalty": 200, "canonical": true, "min_headcount": 1 },
      "Morning3": { "coverage_label": "Canada Day Late",        "coverage_role": "canada_day",          "allowed_regions": ["Canada"],            "preferred_regions": ["Canada"] },
      "Evening1": { "coverage_label": "Canada Evening Early",   "coverage_role": "canada_evening",      "allowed_regions": ["Canada"],            "preferred_regions": ["Canada"] },
      "Evening2": { "coverage_label": "Canada Evening Core",    "coverage_role": "canada_evening",      "allowed_regions": ["Canada"],            "preferred_regions": ["Canada"],             "canonical": true, "min_headcount": 1 },
      "Night1":   { "coverage_label": "Overnight Exception",    "coverage_role": "overnight_exception", "allowed_regions": ["Serbia", "India"],  "preferred_regions": ["Serbia", "India"],  "patch_regions": ["India"],             "fallback_penalty": 40, "patch_penalty": 110, "canonical": true, "min_headcount": 1 }
    }'::jsonb,
    '{"min_rest_hours": 12, "days_off_required": 4, "min_weekly_hours_required": 40, "overtime_threshold_hours": 40, "enforce_senior_per_shift": true}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- RLS: regions and template_registry are readable by authenticated users
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read regions"
  ON regions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read template_registry"
  ON template_registry FOR SELECT
  TO authenticated
  USING (true);

-- Only service role / admin can modify regions and templates
