-- Phase 9, slice 4: filter objectionable content before it's posted
-- (Apple 1.2 asks UGC apps for "a method for filtering objectionable
-- material from being posted", on top of report and block).
--
-- Decided with the user: matching text is *rejected*, never silently
-- masked, and the list is severe terms only: slurs (racial, ethnic,
-- religious, homophobic, transphobic, ableist) and child-sexual-abuse
-- terms. Ordinary swearing stays allowed; everyone is 16+, and reports and
-- mods handle the rest.
--
-- Enforced by BEFORE INSERT/UPDATE triggers on every column people type
-- into, so it holds however the write arrives: the app, an RPC
-- (create_post, create_event_post), or an Edge Function (room-membership's
-- sub-groups). Deliberately NOT filtered: reports.details, because someone
-- reporting abuse may need to quote it. Existing content isn't rescanned.

create extension if not exists unaccent with schema extensions;

-- ── The list ──────────────────────────────────────────────────────────────
-- Stored already normalized: lowercase a-z words, single spaces. Written
-- only with the service role (SQL / Studio), like app_admins; clients can't
-- read it or write it. `pattern` is the regex each term matches, built
-- once per term by filter_term_pattern() below.
create function filter_term_pattern(p_term text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_run text;
  v_out text := '';
begin
  -- One regex piece per run of the same letter: a single letter may be
  -- stretched ("niiiice" style evasions), a doubled one must stay at least
  -- doubled. That is what lets "nigger" match without also matching the
  -- country Niger. A space between words is optional, so "child porn"
  -- also catches "childporn".
  for v_run in select m[1] from regexp_matches(p_term, '(([a-z ])\2*)', 'g') as m loop
    if left(v_run, 1) = ' ' then
      v_out := v_out || ' ?';
    elsif length(v_run) = 1 then
      v_out := v_out || v_run || '+';
    else
      v_out := v_out || left(v_run, 1) || '{' || length(v_run) || ',}';
    end if;
  end loop;
  return v_out;
end;
$$;

create table blocked_terms (
  term text primary key check (term ~ '^[a-z]+( [a-z]+)*$'),
  pattern text generated always as (filter_term_pattern(term)) stored,
  created_at timestamptz not null default now()
);

alter table blocked_terms enable row level security;
revoke all on blocked_terms from anon, authenticated;

-- Left out on purpose, because each is also an everyday word and would
-- refuse ordinary posts: chink ("a chink in the armour"), fag (a
-- cigarette, UK), dyke (a sea wall), coon (raccoon, coonhound), spic
-- ("spic and span"), homo ("Homo sapiens"), poof ("and poof, it's gone"),
-- sambo (the martial art), yid and hebe (names), kaffir ("kaffir lime"),
-- jap/nip, cracker, honky ("honky-tonk"), redskin (a former team name),
-- abo (blood groups), he-she. Reports and mods cover these; add any of
-- them later with an insert if the trade-off changes.
insert into blocked_terms (term) values
  -- anti-Black
  ('nigger'), ('nigga'), ('niggah'), ('nigguh'), ('niqqa'), ('niqqer'),
  ('niglet'), ('nignog'), ('jigaboo'), ('jiggaboo'), ('porch monkey'),
  ('darkie'), ('golliwog'), ('wog'),
  -- anti-Asian
  ('gook'), ('zipperhead'), ('ching chong'), ('slant eye'), ('paki'),
  -- anti-Latino
  ('wetback'), ('beaner'),
  -- anti-Jewish
  ('kike'), ('heeb'),
  -- anti-Arab / anti-Muslim
  ('raghead'), ('towelhead'), ('camel jockey'),
  -- anti-Indigenous, anti-Roma / Traveller
  ('squaw'), ('boong'), ('pikey'), ('gyppo'),
  -- homophobic
  ('faggot'), ('faggit'), ('phaggot'), ('poofter'), ('batty boy'),
  ('batty man'), ('fudge packer'),
  -- transphobic
  ('tranny'), ('trannie'), ('shemale'),
  -- ableist
  ('retard'), ('retarded'), ('spaz'), ('mongoloid'),
  -- child sexual abuse material
  ('child porn'), ('kiddie porn'), ('kiddy porn'), ('preteen porn'),
  ('underage porn'), ('pthc'), ('lolicon'), ('shotacon');

-- ── Normalizing text before matching ──────────────────────────────────────
-- Undoes the common ways people dodge a word list, so the list itself can
-- stay plain words: case, accents, invisible characters, look-alike
-- Cyrillic/Greek letters, digits and symbols standing in for letters,
-- punctuation or spaces between the letters ("n.i.g.g.e.r"). Matching is
-- then whole words only, so "Scunthorpe", "snigger" and "Pakistan" pass.
create function normalize_for_filter(p_text text)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v text;
  v_token text;
  v_run text := '';
  v_out text[] := '{}';
begin
  if p_text is null then
    return '';
  end if;
  -- Zero-width and soft-hyphen characters split a word without a gap.
  -- Removed before unaccent(), which turns a soft hyphen into a real
  -- '-' that would then split the word (found in testing).
  v := regexp_replace(p_text, '[\u00ad\u200b-\u200f\u2060\ufeff]', '', 'g');
  v := lower(extensions.unaccent(v));
  -- Cyrillic and Greek letters that look like Latin ones.
  v := translate(v, 'аеорсуіхкαεορτυικνχ', 'aeopcyixkaeoptuikvx');
  -- Digits and symbols used as letters.
  v := translate(v, '013457@$!|', 'oieastasii');
  v := btrim(regexp_replace(v, '[^a-z]+', ' ', 'g'));
  -- A run of single letters is read as one word: "n i g g e r".
  foreach v_token in array string_to_array(v, ' ') loop
    if length(v_token) = 1 then
      v_run := v_run || v_token;
    else
      if v_run <> '' then
        v_out := v_out || v_run;
        v_run := '';
      end if;
      v_out := v_out || v_token;
    end if;
  end loop;
  if v_run <> '' then
    v_out := v_out || v_run;
  end if;
  return array_to_string(v_out, ' ');
end;
$$;

revoke execute on function filter_term_pattern(text) from public, anon, authenticated;
revoke execute on function normalize_for_filter(text) from public, anon, authenticated;

-- ── The check ─────────────────────────────────────────────────────────────
-- Callable by anyone, including before sign-in: signup checks the handle
-- and name with it first, because Supabase Auth replaces a trigger's error
-- with a generic "Database error saving new user". The trade-off is that
-- anyone can test words against the list; lists like this are public
-- anyway, and the table itself stays unreadable.
create function text_is_allowed(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_pattern text;
begin
  if p_text is null or btrim(p_text) = '' then
    return true;
  end if;
  -- Plurals and "-z" spellings of a term count as the term.
  select '\m(?:' || string_agg(pattern, '|') || ')(?:s|es|z)?\M' into v_pattern from blocked_terms;
  if v_pattern is null then
    return true;
  end if;
  return normalize_for_filter(p_text) !~ v_pattern;
end;
$$;

revoke execute on function text_is_allowed(text) from public;
grant execute on function text_is_allowed(text) to anon, authenticated;

-- ── Enforcement ───────────────────────────────────────────────────────────
-- One trigger function for every table; the columns to check are the
-- trigger's arguments. SECURITY DEFINER so it works whoever writes the row
-- (a signed-in user, the service role in an Edge Function, or the
-- signup trigger); it only reads the row and raises.
create function reject_blocked_terms()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_column text;
  v_new text;
begin
  foreach v_column in array tg_argv loop
    v_new := to_jsonb(new) ->> v_column;
    -- On an edit, only a changed column is checked, so saving a new bio
    -- isn't refused over a name written before this filter existed.
    if tg_op = 'UPDATE' and v_new is not distinct from (to_jsonb(old) ->> v_column) then
      continue;
    end if;
    -- No custom errcode on purpose: P0001 is how the app knows a database
    -- message was written for people to read (lib/errors.ts).
    if not text_is_allowed(v_new) then
      raise exception 'That includes words that aren''t allowed on Chasien. Edit it and try again.';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function reject_blocked_terms() from public, anon, authenticated;

-- `update of <columns>` so removals, pins, counters and presence updates
-- (which never touch these columns) don't run the check at all.
create trigger filter_blocked_terms before insert or update of text, location, tag on posts
for each row execute function reject_blocked_terms('text', 'location', 'tag');

create trigger filter_blocked_terms before insert or update of text on comments
for each row execute function reject_blocked_terms('text');

create trigger filter_blocked_terms before insert or update of text on messages
for each row execute function reject_blocked_terms('text');

create trigger filter_blocked_terms before insert or update of caption on stories
for each row execute function reject_blocked_terms('caption');

create trigger filter_blocked_terms before insert or update of question on polls
for each row execute function reject_blocked_terms('question');

create trigger filter_blocked_terms before insert or update of label on poll_options
for each row execute function reject_blocked_terms('label');

create trigger filter_blocked_terms before insert or update of title, location, link on events
for each row execute function reject_blocked_terms('title', 'location', 'link');

create trigger filter_blocked_terms before insert or update of name, description on rooms
for each row execute function reject_blocked_terms('name', 'description');

-- Sub-group names and descriptions (General's own name is always 'general').
create trigger filter_blocked_terms before insert or update of name, description on conversations
for each row execute function reject_blocked_terms('name', 'description');

-- The handle and name are set once, at signup, by handle_new_user().
create trigger filter_blocked_terms before insert or update of handle, name, bio on profiles
for each row execute function reject_blocked_terms('handle', 'name', 'bio');
