import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ClipTabFields from '@/components/create/ClipTabFields';
import CreateTabSwitcher, { CREATE_TAB_SWITCHER_CLEARANCE, type CreateTab } from '@/components/create/CreateTabSwitcher';
import EventDateTimeModal from '@/components/create/EventDateTimeModal';
import EventTabFields from '@/components/create/EventTabFields';
import LocationSheet from '@/components/create/LocationSheet';
import TagPeopleSheet from '@/components/create/TagPeopleSheet';
import MediaGridPicker, { type MediaGridPickerHandle } from '@/components/create/MediaGridPicker';
import PhotoEditor from '@/components/create/PhotoEditor';
import PollTabFields from '@/components/create/PollTabFields';
import PostTabFields from '@/components/create/PostTabFields';
import ConfirmModal from '@/components/ConfirmModal';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { deletePostMedia, MAX_POST_MEDIA_ITEMS, uploadPostMedia, type PickedMedia } from '@/lib/media';
import { closestFeedShape, isUneditedPhoto, renderPhotoEditPreview, type FeedShape, type PhotoEdit } from '@/lib/mediaUtils';
import { createEventPost, createPost, type TaggedPerson } from '@/lib/posts';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';

type PickPhase = 'pick' | 'review';

function roundUpToNext30Minutes(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const remainder = d.getMinutes() % 30;
  if (remainder > 0) d.setMinutes(d.getMinutes() + (30 - remainder));
  return d;
}

function defaultEventStart(): Date {
  return roundUpToNext30Minutes(new Date(Date.now() + 60 * 60 * 1000));
}

/**
 * The Room feed's "+" button — one modal, four creation kinds (Post/Clip/
 * Poll/Event), switched by the bottom nav (CreateTabSwitcher), mirroring
 * Instagram's own New Post/Reel/Story/Live picker. Every tab's state is
 * lifted up here rather than owned locally by each tab component, so
 * switching tabs mid-draft never loses what was already typed — the same
 * reason `hasChanges` below has to check every tab, not just the active
 * one, before warning about a discard.
 *
 * Post and Clip both submit through the same createPost() RPC Poll always
 * did (Clip is just a video-only post with its own composer chrome). Only
 * Event needs its own RPC — see
 * supabase/migrations/20260915150100_create_event_post_rpc.sql.
 *
 * Post and Clip are each a two-phase flow: 'pick' renders the live camera
 * + device-photo grid (MediaGridPicker), 'review' renders the caption +
 * selected-media editor (PostTabFields/ClipTabFields). Post's review is
 * Instagram's New Post screen: a back arrow to the picker instead of the
 * close button, a Post button pinned at the bottom instead of in the
 * header, and no tab switcher.
 *
 * The phase swap is why the body isn't unconditionally a <ScrollView> — MediaGridPicker owns its own internal scrolling (a live
 * camera plus a FlatList grid), and nesting a FlatList inside another
 * ScrollView is the classic RN VirtualizedList warning this avoids.
 */
export default function CreatePost() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [room, setRoom] = useState<Room | null>(null);
  const [activeTab, setActiveTab] = useState<CreateTab>('post');
  const [submitting, setSubmitting] = useState(false);
  // Next/confirm() is fast on Android (no await on that path) but the
  // header button had no loading/disabled state at all while it ran, so a
  // tap gave zero visual feedback until the picker's camera+grid unmounted
  // and the review screen suddenly appeared — reads as "laggy" even when
  // it's actually quick, and left the button tappable a second time before
  // that swap, which would append the selection twice. Mirrors `submitting`
  // below, just scoped to the pick->review handoff.
  const [pickerBusy, setPickerBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // One key rather than a separate hook per field, since which fields
  // exist changes per tab — 'clip-caption' |
  // 'poll-question' | `poll-option-${index}` | 'event-title' | etc.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const clearFocus = (key: string) => setFocusedField((f) => (f === key ? null : f));

  const [postPhase, setPostPhase] = useState<PickPhase>('pick');
  const [postText, setPostText] = useState('');
  // '' = no location. Trimmed when set (LocationSheet) and again by create_post().
  const [postLocation, setPostLocation] = useState('');
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [postTags, setPostTags] = useState<TaggedPerson[]>([]);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [postMedia, setPostMedia] = useState<PickedMedia[]>([]);
  const [postGridCount, setPostGridCount] = useState(0);
  const postPickerRef = useRef<MediaGridPickerHandle>(null);
  // Every photo in a post shares one shape. null until someone picks one in
  // the photo editor; until then it follows the first photo (below), the
  // same "closest supported shape" rule uploads always used.
  const [postShapeChoice, setPostShapeChoice] = useState<FeedShape | null>(null);
  const [editingPhotoIndex, setEditingPhotoIndex] = useState<number | null>(null);
  const [photoEditorBusy, setPhotoEditorBusy] = useState(false);
  const [photoEditorError, setPhotoEditorError] = useState<string | null>(null);

  const [clipPhase, setClipPhase] = useState<PickPhase>('pick');
  const [clipText, setClipText] = useState('');
  const [clipMedia, setClipMedia] = useState<PickedMedia | null>(null);
  const [clipGridCount, setClipGridCount] = useState(0);
  const clipPickerRef = useRef<MediaGridPickerHandle>(null);

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);

  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStartsAt, setEventStartsAt] = useState<Date>(() => defaultEventStart());
  const [eventStartsPickerOpen, setEventStartsPickerOpen] = useState(false);
  const [includeEndTime, setIncludeEndTime] = useState(false);
  const [eventEndsAt, setEventEndsAt] = useState<Date>(() => roundUpToNext30Minutes(new Date(defaultEventStart().getTime() + 60 * 60 * 1000)));
  const [eventEndsPickerOpen, setEventEndsPickerOpen] = useState(false);
  const [eventLocation, setEventLocation] = useState('');
  const [eventLink, setEventLink] = useState('');

  const userId = session?.user.id;

  useEffect(() => {
    fetchRoomBySlug(communityId)
      .then(setRoom)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
  }, [communityId]);

  const filledPollOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
  const pollReady = pollQuestion.trim().length > 0 && filledPollOptions.length >= 2;

  // Grid counts are included so an in-progress selection that hasn't been
  // confirmed with "Next" yet still counts as a change worth warning
  // about on close — otherwise a captured photo or a tapped grid item
  // could be silently discarded (postMedia/clipMedia stay empty until
  // confirmed).
  const hasChanges =
    postText.trim().length > 0 ||
    postLocation.length > 0 ||
    postTags.length > 0 ||
    postMedia.length > 0 ||
    postGridCount > 0 ||
    clipText.trim().length > 0 ||
    clipMedia !== null ||
    clipGridCount > 0 ||
    pollQuestion.trim().length > 0 ||
    filledPollOptions.length > 0 ||
    pollAllowMultiple ||
    eventTitle.trim().length > 0 ||
    eventDescription.trim().length > 0 ||
    eventLocation.trim().length > 0 ||
    eventLink.trim().length > 0 ||
    includeEndTime;

  const isPicking = (activeTab === 'post' && postPhase === 'pick') || (activeTab === 'clip' && clipPhase === 'pick');
  const isPostReview = activeTab === 'post' && postPhase === 'review';

  const firstPostPhoto = postMedia.find((item) => item.kind === 'image');
  const postShape: FeedShape =
    postShapeChoice ??
    (firstPostPhoto?.kind === 'image' ? closestFeedShape(firstPostPhoto.width, firstPostPhoto.height) : 'square');
  const editingPhoto = editingPhotoIndex !== null ? postMedia[editingPhotoIndex] : undefined;

  const heading =
    activeTab === 'post' ? 'New post' : activeTab === 'clip' ? 'New clip' : activeTab === 'poll' ? 'New poll' : 'New event';

  // Pure display data only — no ref reads here. Refs may only be touched
  // inside an actual event handler (handleHeaderPress below), never while
  // computing a value during render; the React Compiler's `refs` lint rule
  // (this app has `reactCompiler: true`) flags even an object literal
  // built during render that merely *captures* a ref inside a closure,
  // since it can't prove that closure only ever runs later.
  const headerMeta = (() => {
    // postGridCount is the whole post as the grid would confirm it, media
    // already in the post included (MediaGridPicker opens with it ticked),
    // so coming back from review with nothing changed still allows "Next" —
    // and unticking everything correctly doesn't.
    if (activeTab === 'post' && postPhase === 'pick') return { label: 'Next', enabled: postGridCount > 0 };
    if (activeTab === 'clip' && clipPhase === 'pick') return { label: 'Next', enabled: clipGridCount > 0 };
    if (activeTab === 'post') return { label: 'Post', enabled: postText.trim().length > 0 || postMedia.length > 0 };
    if (activeTab === 'clip') return { label: 'Share', enabled: clipMedia !== null };
    if (activeTab === 'poll') return { label: 'Send', enabled: pollReady };
    return { label: 'Send', enabled: eventTitle.trim().length > 0 };
  })();
  const canSubmit = headerMeta.enabled && !submitting && !pickerBusy;

  async function handleHeaderPress() {
    if (activeTab === 'post' && postPhase === 'pick') {
      setPickerBusy(true);
      try {
        await postPickerRef.current?.confirm();
      } finally {
        setPickerBusy(false);
      }
      return;
    }
    if (activeTab === 'clip' && clipPhase === 'pick') {
      setPickerBusy(true);
      try {
        await clipPickerRef.current?.confirm();
      } finally {
        setPickerBusy(false);
      }
      return;
    }
    handleSubmit();
  }

  const handleClose = useCallback(() => {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      router.back();
    }
  }, [hasChanges]);

  // Android hardware back / edge-swipe is a separate system event
  // native-stack handles on its own by default — without this it would
  // silently discard a draft with no confirmation. See PostFab's sibling
  // create-community.tsx for the original fix this mirrors. On the Post
  // review screen it matches that screen's own back arrow instead: back to
  // the picker, draft kept — but not mid-upload.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (editingPhotoIndex !== null) {
          // Same as the editor's own ✕ — discard this edit, keep the post.
          if (!photoEditorBusy) setEditingPhotoIndex(null);
        } else if (isPostReview) {
          if (!submitting) setPostPhase('pick');
        } else {
          handleClose();
        }
        return true;
      });
      return () => subscription.remove();
    }, [handleClose, isPostReview, submitting, editingPhotoIndex, photoEditorBusy]),
  );

  if (!session) return null;

  function removePostMediaAt(index: number) {
    setPostMedia((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setPostPhase('pick');
        // A fresh set of photos starts from its own first photo's shape again.
        setPostShapeChoice(null);
      }
      return next;
    });
  }

  function openPhotoEditor(index: number) {
    setPhotoEditorError(null);
    setEditingPhotoIndex(index);
  }

  // Renders previews one photo at a time, not in parallel: each render
  // decodes a full camera photo, and several at once is how a low-end
  // phone runs out of memory.
  async function handlePhotoEditDone(edit: PhotoEdit, shape: FeedShape) {
    if (editingPhotoIndex === null) return;
    setPhotoEditorBusy(true);
    setPhotoEditorError(null);
    try {
      const next: PickedMedia[] = [];
      for (let i = 0; i < postMedia.length; i++) {
        const item = postMedia[i];
        if (item.kind !== 'image') {
          next.push(item);
        } else if (i === editingPhotoIndex) {
          next.push(
            isUneditedPhoto(edit)
              ? { ...item, edit: undefined, previewUri: undefined }
              : { ...item, edit, previewUri: await renderPhotoEditPreview(item, edit, shape) },
          );
        } else if (shape !== postShape && item.edit) {
          // The shape is shared, so changing it re-frames every other edited
          // photo too; its relative crop carries over into the new shape.
          next.push({ ...item, previewUri: await renderPhotoEditPreview(item, item.edit, shape) });
        } else {
          next.push(item);
        }
      }
      setPostMedia(next);
      setPostShapeChoice(shape);
      setEditingPhotoIndex(null);
    } catch (e) {
      setPhotoEditorError(e instanceof Error ? e.message : 'Could not apply that edit.');
    } finally {
      setPhotoEditorBusy(false);
    }
  }

  function removeClipMedia() {
    setClipMedia(null);
    setClipPhase('pick');
  }

  function updatePollOption(index: number, value: string) {
    setPollOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function handleToggleEndTime(value: boolean) {
    setIncludeEndTime(value);
    // Recomputed from the current start every time it's switched on, not
    // just once — if someone changes "Starts" first, toggling this back on
    // should default relative to the new start, not a stale one.
    if (value) setEventEndsAt(roundUpToNext30Minutes(new Date(eventStartsAt.getTime() + 60 * 60 * 1000)));
  }

  async function handleSubmit() {
    if (!canSubmit || !room || !userId) return;
    setSubmitting(true);
    setError(null);

    try {
      if (activeTab === 'post') {
        const uploadedPaths: string[] = [];
        try {
          for (let i = 0; i < postMedia.length; i++) {
            setStatusLine(postMedia.length > 1 ? `Uploading ${i + 1} of ${postMedia.length}…` : 'Uploading…');
            uploadedPaths.push(await uploadPostMedia(postMedia[i], room.id, userId, postShape));
          }
          setStatusLine('Posting…');
          await createPost({
            roomId: room.id,
            text: postText,
            mediaPaths: uploadedPaths,
            pollQuestion: null,
            pollOptions: [],
            location: postLocation || null,
            taggedUserIds: postTags.map((t) => t.userId),
          });
        } catch (e) {
          // Media lands in storage before the post row exists, so a
          // failure here would otherwise strand every object already
          // uploaded, not just the last one.
          if (uploadedPaths.length > 0) await Promise.allSettled(uploadedPaths.map((p) => deletePostMedia(p)));
          throw e;
        }
      } else if (activeTab === 'clip') {
        if (!clipMedia) return;
        setStatusLine('Uploading…');
        const path = await uploadPostMedia(clipMedia, room.id, userId);
        try {
          setStatusLine('Posting…');
          await createPost({ roomId: room.id, text: clipText, mediaPaths: [path], pollQuestion: null, pollOptions: [] });
        } catch (e) {
          await deletePostMedia(path);
          throw e;
        }
      } else if (activeTab === 'poll') {
        setStatusLine('Posting…');
        await createPost({
          roomId: room.id,
          text: '',
          mediaPaths: [],
          pollQuestion,
          pollOptions: filledPollOptions,
          pollAllowMultiple,
        });
      } else {
        setStatusLine('Sending…');
        await createEventPost({
          roomId: room.id,
          text: eventDescription,
          title: eventTitle,
          startsAt: eventStartsAt.toISOString(),
          endsAt: includeEndTime ? eventEndsAt.toISOString() : null,
          location: eventLocation.trim() || null,
          link: eventLink.trim() || null,
        });
      }

      router.replace({ pathname: '/c/[communityId]', params: { communityId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish that.');
    } finally {
      setSubmitting(false);
      setStatusLine(null);
    }
  }

  // Replaces the composer rather than covering it: unmounting the review
  // screen's carousel (and any video players in it) while the editor holds
  // a decoded photo matters on a low-end phone. All draft state lives in
  // this component, so nothing is lost.
  if (editingPhoto?.kind === 'image') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <PhotoEditor
          photo={editingPhoto}
          initialShape={postShape}
          isCarousel={postMedia.length > 1}
          busy={photoEditorBusy}
          error={photoEditorError}
          onCancel={() => setEditingPhotoIndex(null)}
          onDone={handlePhotoEditDone}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          {isPostReview ? (
            <Pressable onPress={() => setPostPhase('pick')} disabled={submitting} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to photos">
              <Icon name="back" size={22} color={colors.text} />
            </Pressable>
          ) : (
            <Pressable onPress={handleClose} disabled={submitting} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={20} color={colors.text} />
            </Pressable>
          )}
          <Text style={styles.headingText}>{heading}</Text>
          {isPostReview ? (
            // Keeps the title centered; the Post button lives in the footer on this screen.
            <View style={styles.headerSpacer} />
          ) : (
            <Pressable onPress={handleHeaderPress} disabled={!canSubmit}>
              {submitting || pickerBusy ? (
                <ActivityIndicator color={colors.accent.DEFAULT} />
              ) : (
                <Text style={[styles.headerAction, !canSubmit && styles.headerActionDisabled]}>{headerMeta.label}</Text>
              )}
            </Pressable>
          )}
        </View>

        {isPicking ? (
          <View style={styles.pickerBody}>
            {activeTab === 'post' && (
              <MediaGridPicker
                ref={postPickerRef}
                mode="post"
                stagedMedia={postMedia}
                maxSelectable={MAX_POST_MEDIA_ITEMS}
                onSelectionChange={setPostGridCount}
                onConfirm={(items) => {
                  // The grid hands back the post's complete list, so this
                  // replaces rather than appends — appending is what used to
                  // put a re-ticked photo in the post twice.
                  setPostMedia(items);
                  setPostGridCount(0);
                  if (items.length > 0) {
                    setPostPhase('review');
                  } else {
                    setPostShapeChoice(null);
                  }
                }}
              />
            )}
            {activeTab === 'clip' && (
              <MediaGridPicker
                ref={clipPickerRef}
                mode="clip"
                onSelectionChange={setClipGridCount}
                onConfirm={(items) => {
                  if (items[0]) setClipMedia(items[0]);
                  setClipGridCount(0);
                  setClipPhase('review');
                }}
              />
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, isPostReview && styles.postReviewContent]} keyboardShouldPersistTaps="handled">
            {activeTab === 'post' && (
              <PostTabFields
                text={postText}
                onChangeText={setPostText}
                media={postMedia}
                shape={postShape}
                onRemoveMedia={removePostMediaAt}
                onEditPhoto={openPhotoEditor}
                tags={postTags}
                onOpenTags={() => setTagSheetOpen(true)}
                location={postLocation}
                onOpenLocation={() => setLocationSheetOpen(true)}
                onClearLocation={() => setPostLocation('')}
                submitting={submitting}
              />
            )}
            {activeTab === 'clip' && clipMedia && (
              <ClipTabFields
                text={clipText}
                onChangeText={setClipText}
                media={clipMedia}
                onRemoveMedia={removeClipMedia}
                focusedField={focusedField}
                onFocusField={setFocusedField}
                onBlurField={clearFocus}
                submitting={submitting}
              />
            )}
            {activeTab === 'poll' && (
              <PollTabFields
                question={pollQuestion}
                onChangeQuestion={setPollQuestion}
                options={pollOptions}
                onChangeOption={updatePollOption}
                onAddOption={() => setPollOptions((prev) => [...prev, ''])}
                allowMultiple={pollAllowMultiple}
                onToggleAllowMultiple={setPollAllowMultiple}
                pollReady={pollReady}
                focusedField={focusedField}
                onFocusField={setFocusedField}
                onBlurField={clearFocus}
                submitting={submitting}
              />
            )}
            {activeTab === 'event' && (
              <EventTabFields
                title={eventTitle}
                onChangeTitle={setEventTitle}
                description={eventDescription}
                onChangeDescription={setEventDescription}
                startsAt={eventStartsAt}
                onOpenStartsPicker={() => setEventStartsPickerOpen(true)}
                includeEndTime={includeEndTime}
                onToggleEndTime={handleToggleEndTime}
                endsAt={eventEndsAt}
                onOpenEndsPicker={() => setEventEndsPickerOpen(true)}
                location={eventLocation}
                onChangeLocation={setEventLocation}
                link={eventLink}
                onChangeLink={setEventLink}
                focusedField={focusedField}
                onFocusField={setFocusedField}
                onBlurField={clearFocus}
                submitting={submitting}
              />
            )}

            {!isPostReview && statusLine && <Text style={styles.status}>{statusLine}</Text>}
            {!isPostReview && error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>
        )}

        {/* Upload progress and errors sit with the button that caused them,
            not at the end of a scroll a tall photo can push off-screen. The
            SafeAreaView's bottom edge already keeps this above the nav bar. */}
        {isPostReview && (
          <View style={styles.footer}>
            {statusLine && <Text style={styles.status}>{statusLine}</Text>}
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: submitting }}
            >
              {submitting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Post</Text>}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {!isPostReview && <CreateTabSwitcher active={activeTab} onChange={setActiveTab} disabled={submitting} />}

      <ConfirmModal
        visible={showDiscardConfirm}
        title="Discard this?"
        body="Everything you've entered so far will be lost — this can't be undone."
        cancelLabel="Keep Editing"
        confirmLabel="Discard"
        onCancel={() => setShowDiscardConfirm(false)}
        onConfirm={() => router.back()}
      />

      {room && userId && (
        <TagPeopleSheet
          visible={tagSheetOpen}
          roomId={room.id}
          userId={userId}
          value={postTags}
          onDone={(people) => {
            setPostTags(people);
            setTagSheetOpen(false);
          }}
          onClose={() => setTagSheetOpen(false)}
        />
      )}

      <LocationSheet
        visible={locationSheetOpen}
        value={postLocation}
        onDone={(location) => {
          setPostLocation(location);
          setLocationSheetOpen(false);
        }}
        onClose={() => setLocationSheetOpen(false)}
      />

      <EventDateTimeModal
        visible={eventStartsPickerOpen}
        title="Starts"
        value={eventStartsAt}
        onChange={setEventStartsAt}
        onClose={() => setEventStartsPickerOpen(false)}
      />
      <EventDateTimeModal
        visible={eventEndsPickerOpen}
        title="Ends"
        value={eventEndsAt}
        onChange={setEventEndsAt}
        onClose={() => setEventEndsPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing[6],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[4],
    },
    headingText: {
      fontFamily: Fonts.heading,
      fontSize: 16,
      color: colors.text,
    },
    headerAction: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.accent.DEFAULT,
    },
    headerActionDisabled: {
      opacity: 0.35,
    },
    headerSpacer: {
      width: 22,
    },
    pickerBody: {
      flex: 1,
      paddingHorizontal: Spacing[6],
      paddingBottom: CREATE_TAB_SWITCHER_CLEARANCE,
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    content: {
      paddingHorizontal: Spacing[6],
      paddingBottom: Spacing[8] + CREATE_TAB_SWITCHER_CLEARANCE,
      gap: Spacing[3],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    // PostCard's own horizontal padding, so the preview is drawn at the
    // feed's width, not just its shape. No tab-switcher clearance: that
    // bar is hidden on this screen and the Post button sits below the
    // ScrollView, not over it.
    postReviewContent: {
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[6],
    },
    footer: {
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[3],
      paddingBottom: Spacing[4],
      gap: Spacing[2],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    submitButton: {
      height: 54,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitButtonDisabled: {
      opacity: 0.4,
    },
    submitButtonText: {
      fontFamily: Fonts.heading,
      fontSize: 16,
      color: colors.bg,
    },
    status: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.accent2[300],
      textAlign: 'center',
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.accent.DEFAULT,
      textAlign: 'center',
    },
  });
