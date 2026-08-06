-- Add survey_attendants table for managing attendant names
CREATE TABLE IF NOT EXISTS survey_attendants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(survey_id, name)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_survey_attendants_survey_id ON survey_attendants(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_attendants_active ON survey_attendants(survey_id, is_active);
