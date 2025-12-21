-- Create enums
CREATE TYPE public.shift_time AS ENUM ('morning', 'evening', 'night');
CREATE TYPE public.leave_type AS ENUM ('annual', 'sick-reported', 'sick-unreported', 'extra');
CREATE TYPE public.transmission_type AS ENUM ('SNG', 'TVU', 'AVIWEST', 'UNIVISO', 'LiveU', 'Turnaround', 'SRT Link', 'RTMP Link');
CREATE TYPE public.channel_status AS ENUM ('active', 'inactive', 'maintenance');
CREATE TYPE public.issue_type AS ENUM ('Image', 'Sound', 'Graphic');
CREATE TYPE public.issue_status AS ENUM ('open', 'resolved');

-- Satellites table
CREATE TABLE public.satellites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SNG Satellites table
CREATE TABLE public.sng_satellites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  encoder TEXT,
  power_amplifier TEXT,
  dish TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Operators table
CREATE TABLE public.operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channels table
CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  satellite_id UUID REFERENCES public.satellites(id) ON DELETE SET NULL,
  bitrate INTEGER,
  frequency TEXT,
  modulation TEXT,
  polarization TEXT,
  symbol_rate TEXT,
  status channel_status DEFAULT 'active',
  stream_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients table
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  email TEXT,
  phone1 TEXT NOT NULL,
  phone2 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client Channels junction table
CREATE TABLE public.client_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, channel_id)
);

-- Issues table
CREATE TABLE public.issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  issue_type issue_type NOT NULL,
  detail TEXT,
  reason TEXT,
  description TEXT,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  satellite_id UUID REFERENCES public.satellites(id) ON DELETE SET NULL,
  operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  status issue_status DEFAULT 'open',
  resolution_reason TEXT,
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DTL (Downlink/Transmission Link) table
CREATE TABLE public.dtl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  transmission_type transmission_type NOT NULL,
  satellite_id UUID REFERENCES public.sng_satellites(id) ON DELETE SET NULL,
  encoder TEXT,
  power_amplifier TEXT,
  dish TEXT,
  from_location TEXT,
  via_location TEXT,
  issue_description TEXT,
  reason TEXT,
  notes TEXT,
  guest_name TEXT,
  fees DECIMAL(10,2) DEFAULT 0,
  operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shifts table
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  shift_time shift_time NOT NULL,
  operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leave Requests table
CREATE TABLE public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type leave_type NOT NULL,
  note TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Bitrate Records table
CREATE TABLE public.bitrate_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift_time shift_time NOT NULL,
  bitrate_value INTEGER NOT NULL,
  operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Settings table
CREATE TABLE public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_satellites_updated_at BEFORE UPDATE ON public.satellites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sng_satellites_updated_at BEFORE UPDATE ON public.sng_satellites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_operators_updated_at BEFORE UPDATE ON public.operators FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_issues_updated_at BEFORE UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dtl_updated_at BEFORE UPDATE ON public.dtl FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on all tables (allowing public access for now since auth is handled by custom backend)
ALTER TABLE public.satellites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sng_satellites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dtl ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitrate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Create public access policies (since auth is handled by custom Node.js backend)
CREATE POLICY "Allow public access to satellites" ON public.satellites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to sng_satellites" ON public.sng_satellites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to operators" ON public.operators FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to channels" ON public.channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to clients" ON public.clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to client_channels" ON public.client_channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to issues" ON public.issues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to dtl" ON public.dtl FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to shifts" ON public.shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to leave_requests" ON public.leave_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to bitrate_records" ON public.bitrate_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access to settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

-- Insert default operators
INSERT INTO public.operators (name) VALUES 
  ('Walid'),
  ('Ahmed'),
  ('Helmi'),
  ('Oussema'),
  ('Houssem');

-- Insert default satellites
INSERT INTO public.satellites (name) VALUES 
  ('Nilesat'),
  ('Hotbird'),
  ('Eshailsat'),
  ('Streaming');