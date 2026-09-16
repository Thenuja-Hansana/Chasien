-- Event tab visual-fidelity pass: adds the two extra Event fields that are
-- cheap and honest to support for real — an optional end time and an
-- optional link the organizer pastes themselves (this app has no WhatsApp
-- integration, so it can't generate a real WhatsApp call link the way the
-- reference design's field implies). Reminder and Allow-guests stay out
-- entirely — no scheduled-job system and no RSVP feature exist yet, and a
-- toggle with nothing behind it is worse than no toggle.

alter table events add column ends_at timestamptz;
alter table events add column link text;
