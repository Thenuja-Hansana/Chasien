-- Phase 10, slice 6 (1 of 4): how long text can be.
--
-- Found in slice 4: nothing limited text length. A 200,000-character post
-- was accepted, and so would a message, a comment or a bio have been. Only
-- posts.location (100), reports.details (1,000), handles (3-30) and Room
-- slugs (3-50) had a rule, and the app set a maximum on two inputs. The
-- database is capped at 500 MB on the free tier, and every one of these
-- columns is also read by the content filter's regex on insert.
--
-- The numbers were agreed with Thenuja on 2026-10-02. Each is well above
-- the longest value in the data that day (in brackets), so every existing
-- row passes and the constraints are added validated:
--
--   post text 2,000 (93)          comment 1,000 (73)       message 4,000 (67)
--   bio 160 (83)                  display name 50 (14)
--   Room name 50 (24)             Room description 300 (97)
--   sub-group name 50 (11)        sub-group description 300
--   story caption 200             poll question 150 (16)   poll option 60 (12)
--   event title 100 (6)           event location 100       event link 500
--
-- Four more columns take text from a client and get a ceiling for the same
-- reason, though nobody types into them freely: posts.tag (50; unused by
-- the app today), a reaction's emoji (16: one emoji can be several code
-- points), a Room's required email domain (255, the DNS limit) and a push
-- token (255; Expo's are about 40).
--
-- char_length() counts characters, not bytes, which is what the app's
-- `maxLength` counts too (mobile/src/constants/limits.ts carries the same
-- numbers). The app stops typing at the limit, so a person never sees these
-- fire; they are for a client that isn't the app.
--
-- A display name is also set at signup, by handle_new_user() from the
-- signup form's metadata. A name over 50 there fails the signup, so the
-- signup screen has the same maximum.

alter table posts
  add constraint posts_text_length check (text is null or char_length(text) <= 2000),
  add constraint posts_tag_length check (tag is null or char_length(tag) <= 50);

alter table comments
  add constraint comments_text_length check (char_length(text) <= 1000);

alter table messages
  add constraint messages_text_length check (text is null or char_length(text) <= 4000);

alter table profiles
  add constraint profiles_name_length check (char_length(name) between 1 and 50),
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 160);

alter table rooms
  add constraint rooms_name_length check (char_length(name) between 1 and 50),
  add constraint rooms_description_length check (description is null or char_length(description) <= 300),
  add constraint rooms_required_email_domain_length check (required_email_domain is null or char_length(required_email_domain) <= 255);

alter table conversations
  add constraint conversations_name_length check (name is null or char_length(name) <= 50),
  add constraint conversations_description_length check (description is null or char_length(description) <= 300);

alter table stories
  add constraint stories_caption_length check (caption is null or char_length(caption) <= 200);

alter table polls
  add constraint polls_question_length check (char_length(question) <= 150);

alter table poll_options
  add constraint poll_options_label_length check (char_length(label) <= 60);

alter table events
  add constraint events_title_length check (char_length(title) <= 100),
  add constraint events_location_length check (location is null or char_length(location) <= 100),
  add constraint events_link_length check (link is null or char_length(link) <= 500);

alter table message_reactions
  add constraint message_reactions_emoji_length check (char_length(emoji) <= 16);

alter table push_tokens
  add constraint push_tokens_token_length check (char_length(token) <= 255);
