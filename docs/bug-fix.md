# Chasien — Bones Phase UI/UX bug-fix checklist

Working list from the user's 2026-09-02 review of the black/white theme and
responsive pass. Fixing one at a time, in order, verifying each on the real
device before moving to the next — not batching them all into one untested
change. Numbering below matches the user's own list (they numbered 1-5, then
7-9, skipping 6 — confirmed a plain numbering slip, no missing item).

- [x] **1. Header top margin** — every screen header's `paddingTop` bumped
      from `Spacing[3]` (13.2) to `Spacing[4]` (17.6), a small, consistent
      increase across all ~13 screens that have one.

- [x] **2. Text input focus highlight** — added `hooks/use-focus-highlight.ts`
      (onFocus/onBlur-driven `focused` state) and applied it to every one of
      the app's 17 `TextInput`s (login, signup, discover/search, chat
      composer, comment composer, Room settings description, create-Room
      name/description, create-story caption, create-post caption/poll
      question/poll options). Each field now highlights only while it
      actually has focus, using the same border treatment Password used to
      have hardcoded permanently.

- [x] **3. Show-password eye icon** — added an `eyeOff` icon
      (`components/Icon.tsx`) alongside the existing `eye`; both password
      fields (login, signup) now have a tappable eye toggle wired to
      `secureTextEntry`.

- [x] **4. Tab switch animation** — went with the lighter fix instead of the
      full persistent-`Tabs` rewrite (see the note this replaces, below):
      `_layout.tsx`'s root `Stack` now overrides `animation: 'none'` on the
      four tab routes (`index`, `discover`, `chats/index`, `u/[userId]`),
      so switching between them is an instant swap instead of a slide.
      Drilling into a Room, a post, settings, or a chat thread still gets
      the normal slide — that's still the right cue for "going deeper", not
      for switching sections. Confirmed by the user as a real improvement.
      The full `Tabs` architecture is still the more "correct" long-term
      fix if a genuinely persistent bar (never re-rendering on tab switch)
      is wanted later — revisit if this lighter version ever feels
      insufficient.

- [x] **5. Post icon moved out of the main tab bar** — `TabBar` is now
      Home/Explore/Chats/You only. Inside a Room, a round "+" button
      (`components/PostFab.tsx`) floats above the tab bar's right side —
      revised 2026-09-02 from an initial pill-with-"Post"-text design
      (straddling the bar, centered) after the user preferred a plain
      round circle on the right, closer to the original FAB it replaces
      (see #9) — same safe-area-correct positioning, different shape.

- [x] **6.** — confirmed a numbering slip, not a missing item.

- [x] **7. Chat composer vs. keyboard (Android)** — root cause was actually
      *not* the Android manifest (`windowSoftInputMode="adjustResize"` was
      already set correctly) — it's that Expo's default edge-to-edge
      display (this app targets Android 15+) makes `adjustResize` stop
      actually resizing content, so `KeyboardAvoidingView` needs its own
      JS-driven adjustment regardless. Changed `behavior` from `undefined`
      to `'height'` on Android in every screen that has a
      `KeyboardAvoidingView` (chat thread, comment composer, login, signup,
      create-post, create-story) — previously only iOS got a `behavior` at
      all.

- [x] **8. Odd spacing inside a Room feed** — initial investigation (against
      the live local database) ruled out `PostCard`'s poll-only layout as
      the cause but couldn't reproduce the actual gap without a device
      screenshot. **Resolved** by the "Story row huge gap" follow-up below:
      the real cause was the horizontal story-row `ScrollView` not sizing
      itself to content on Android and stretching to fill free vertical
      space. Fixed by wrapping it in a `storyScroll` `View` with a hard
      `height: 92` (`app/c/[communityId]/index.tsx`) — confirmed in place
      and verified against both Spiderman Club (one post) and Grit Club
      (three posts), no regression.

- [x] **9. Create-post button in the wrong place** — this turned out to be
      a real, separate bug, not just #5's tab icon: `c/[communityId]/index.tsx`
      already had its own floating "+" button with a hardcoded
      `bottom: 96`, not the device's actual safe-area inset — the same
      class of bug as #1/#7. Removed it and replaced it with the new
      `PostFab` (#5), so there's now exactly one, correctly-positioned
      entry point.

---

- [x] **(follow-up, 2026-09-02) "Newest first" label removed** — the Room
      feed's divider between the story row and the first post now shows a
      plain horizontal rule with even spacing above/below, no label text.
      Also directly touches the area #8 flagged — worth re-checking
      whether that spacing complaint still stands after this.

## Follow-ups found and fixed while verifying the above (2026-09-02)

- [x] **Story row huge gap on a Room with little content** — turned out to
      be the real #8 bug, reproduced live against Spiderman Club: a
      horizontal `ScrollView` on Android doesn't reliably size itself to
      content and was stretching to fill whatever vertical space was free.
      Fixed by wrapping it in a plain `View` with a hard height (a
      `ScrollView`'s own `style.height` wasn't enough — confirmed by
      diagnostic-coloring the actual render before finding this). Verified
      against both a one-post Room (Spiderman Club) and a three-post Room
      (Grit Club) — no regression.
- [x] **Story-row-to-divider spacing tightened** — reduced after the fix
      above made the real gap visible for the first time; cut by roughly
      half at the user's request.
