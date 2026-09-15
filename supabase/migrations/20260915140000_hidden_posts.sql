-- Per-viewer "hide this post from my feed" — distinct from Delete/removal:
-- hiding is personal declutter, invisible to everyone else, and doesn't
-- touch the post row at all. Structurally identical to post_likes (a plain
-- user_id/post_id join row with its own RLS), just private instead of
-- room-visible — see row_level_security.sql's post_likes policies for the
-- same select/insert/delete shape this mirrors.
--
-- No unhide UI exists yet, but the table needs no schema change to support
-- one later: unhiding is just deleting this row, already covered by the
-- delete policy below.

create table hidden_posts (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id uuid not null references posts (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table hidden_posts enable row level security;

create policy "users can see their own hidden posts"
on hidden_posts for select
to authenticated
using (user_id = auth.uid());

create policy "users can hide a post for themselves"
on hidden_posts for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can unhide their own hidden post"
on hidden_posts for delete
to authenticated
using (user_id = auth.uid());
