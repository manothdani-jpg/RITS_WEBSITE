-- Volunteer signups now say whether the person can help at specific events
-- or all the time. Event-specific volunteers also pick which event(s).
--
-- availability is NULL for signups made before this existed (we never asked),
-- so the admin list shows "—" for them instead of guessing.

ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS availability TEXT
  CHECK (availability IN ('event_specific', 'all_time'));

CREATE TABLE IF NOT EXISTS volunteer_events (
  volunteer_id UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_volunteer_events_event_id ON volunteer_events(event_id);
