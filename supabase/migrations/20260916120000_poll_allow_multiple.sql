-- Lets a poll's creator allow voters to pick more than one option.
--
-- feed.sql originally put the primary key on poll_votes as (poll_id,
-- user_id), specifically so a second vote for a different option in the
-- same poll was rejected at the schema level. That invariant only holds
-- for single-choice polls now, so it moves off the primary key (which
-- can't be conditional) and into vote_poll_rpc.sql's own logic instead.
-- The new primary key just prevents the same person from double-voting
-- the *same* option twice, which is still always true regardless of
-- allow_multiple.

alter table polls add column allow_multiple boolean not null default false;

alter table poll_votes drop constraint poll_votes_pkey;
alter table poll_votes add primary key (poll_id, poll_option_id, user_id);
