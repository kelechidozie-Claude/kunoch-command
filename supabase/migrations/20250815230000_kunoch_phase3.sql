-- Kunoch Command Phase 3 — Supabase Schema
-- Project: eplsmeenlwbglgtnzxau

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── BUSINESSES ──────────────────────────────────────────────
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users DEFAULT auth.uid(),
  name TEXT NOT NULL,
  legal_entity TEXT,
  jurisdictions TEXT,
  positioning TEXT,
  stage TEXT,
  revenue TEXT,
  currency TEXT DEFAULT 'USD',
  business_model TEXT,
  target_customer TEXT,
  key_people TEXT,
  p1 TEXT,
  p2 TEXT,
  p3 TEXT,
  constraints TEXT,
  competitors TEXT,
  challenges TEXT,
  c1 TEXT DEFAULT '#C9A84C',
  c2 TEXT DEFAULT '#1A1D2B',
  c3 TEXT DEFAULT '#34D399',
  font_h TEXT,
  font_b TEXT,
  tone TEXT,
  values TEXT,
  dos TEXT,
  donts TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RUNS ────────────────────────────────────────────────────
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users DEFAULT auth.uid(),
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  summary TEXT,
  agents TEXT[],
  briefs JSONB DEFAULT '{}',
  outputs JSONB DEFAULT '{}',
  follow_ups JSONB DEFAULT '[]',
  synthesis TEXT,
  usage JSONB DEFAULT '{}',
  cost NUMERIC DEFAULT 0,
  stars TEXT[] DEFAULT '{}',
  run_date TEXT,
  run_time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── MEETINGS (Phase 4 prep) ────────────────────────────────
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users DEFAULT auth.uid(),
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT,
  platform TEXT,
  meeting_date DATE,
  attendees TEXT[],
  agenda TEXT,
  transcript TEXT,
  decisions TEXT[],
  action_items JSONB DEFAULT '[]',
  open_questions TEXT[],
  flags TEXT[],
  raw_metadata JSONB DEFAULT '{}',
  sha256 TEXT,
  provenance TEXT DEFAULT 'imported',
  file_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUDIT LOG (append-only) ────────────────────────────────
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users DEFAULT auth.uid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── MONTHLY COSTS ───────────────────────────────────────────
CREATE TABLE monthly_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users DEFAULT auth.uid(),
  year_month TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  details JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year_month)
);

-- ── APP SETTINGS ────────────────────────────────────────────
CREATE TABLE app_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users DEFAULT auth.uid(),
  active_business_id TEXT REFERENCES businesses(id),
  draft_task TEXT,
  version TEXT DEFAULT '3.1',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDICES ─────────────────────────────────────────────────
CREATE INDEX idx_runs_business ON runs(business_id, created_at DESC);
CREATE INDEX idx_runs_user ON runs(user_id, created_at DESC);
CREATE INDEX idx_meetings_business ON meetings(business_id, meeting_date DESC);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id, created_at DESC);
CREATE INDEX idx_businesses_user ON businesses(user_id, sort_order);

-- ── RLS ENABLE ──────────────────────────────────────────────
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ── RLS POLICIES ────────────────────────────────────────────
-- Users can only see their own data
CREATE POLICY "user_businesses" ON businesses
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_runs" ON runs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_meetings" ON meetings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_audit" ON audit_log
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_costs" ON monthly_costs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_settings" ON app_settings
  FOR ALL USING (auth.uid() = user_id);

-- ── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER meetings_updated_at BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER monthly_costs_updated_at BEFORE UPDATE ON monthly_costs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── AUDIT TRIGGER ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log (user_id, table_name, record_id, action, old_data)
    VALUES (auth.uid(), TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log (user_id, table_name, record_id, action, old_data, new_data)
    VALUES (auth.uid(), TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_log (user_id, table_name, record_id, action, new_data)
    VALUES (auth.uid(), TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER businesses_audit AFTER INSERT OR UPDATE OR DELETE ON businesses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER runs_audit AFTER INSERT OR UPDATE OR DELETE ON runs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER meetings_audit AFTER INSERT OR UPDATE OR DELETE ON meetings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
