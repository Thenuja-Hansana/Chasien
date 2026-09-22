import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import BlockConfirmModal from '@/components/BlockConfirmModal';
import ConfirmModal from '@/components/ConfirmModal';
import Icon from '@/components/Icon';
import MessageBubble from '@/components/MessageBubble';
import OptionsSheet from '@/components/OptionsSheet';
import ReportSheet, { type ReportTarget } from '@/components/ReportSheet';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { blockUser, fetchBlockedIds, fetchBlockStatus, unblockUser, type BlockStatus } from '@/lib/blocks';
import {
  addReaction,
  fetchConversationSummary,
  fetchMessages,
  fetchOtherParticipantLastRead,
  markConversationRead,
  removeReaction,
  sendMessage,
  subscribeToMessages,
  subscribeToReadReceipt,
  subscribeToTyping,
  type InboxItem,
  type Message,
} from '@/lib/chat';
import { pickImage } from '@/lib/media';
import { fetchMutedInChat, removeMessage, setMutedInChat } from '@/lib/moderation';
import { fetchMyMembership, type RoomRole } from '@/lib/rooms';
import { signMessageMediaUrls, uploadMessageImage, uploadMessageVoice } from '@/lib/messageMedia';

const TYPING_CLEAR_MS = 3000;

export default function ChatView() {
  const { session } = useAuth();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const userId = session?.user.id;
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [summary, setSummary] = useState<InboxItem | null | 'loading'>('loading');
  // null = not fetched yet (still loading), distinct from `[]` (a real
  // conversation with no messages) — before this, a realtime insert or
  // the send handlers could also arrive before fetchMessages() resolved,
  // so the two states need to stay tellable apart everywhere `messages`
  // is touched below, not just at the initial fetch.
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState('');
  const draftFocus = useFocusHighlight();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null);
  // DMs only: whether either person has blocked the other. The server
  // enforces it by refusing messages; this just swaps the composer for an
  // explanation instead of letting a send fail.
  const [blockStatus, setBlockStatus] = useState<BlockStatus>('none');
  // Room chats only: people the viewer blocked, whose messages collapse
  // here. The server leaves group-chat messages alone on purpose
  // (20260921100000_block_enforcement.sql), so this is client-side.
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  // Room chats only: the viewer's role in the Room (owner/admin/mod can
  // remove messages and mute people here) and who's muted in this chat.
  const [chatRole, setChatRole] = useState<RoomRole | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  /** The message whose long-press options are open. */
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const [removingMessage, setRemovingMessage] = useState<Message | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  /** Blocked from the report sheet; refetched once it closes. */
  const [blockedViaReport, setBlockedViaReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof subscribeToTyping> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const load = useCallback(() => {
    if (!chatId || !userId) return;
    setSummary('loading');
    fetchBlockedIds(userId).then(setBlockedIds).catch(() => {});
    fetchConversationSummary(chatId, userId)
      .then(async (s) => {
        setSummary(s);
        if (!s) return;
        const rows = await fetchMessages(chatId);
        setMessages(rows);
        await markConversationRead(chatId, userId);
        if (s.kind === 'room_channel' && s.room_id) {
          const membership = await fetchMyMembership(s.room_id, userId);
          setChatRole(membership?.join_state === 'approved' ? membership.role : null);
          setMutedIds(await fetchMutedInChat(chatId));
        }
        if (s.kind === 'dm' && s.otherUserId) {
          setBlockStatus(await fetchBlockStatus(s.otherUserId));
          setOtherLastRead(await fetchOtherParticipantLastRead(chatId, s.otherUserId));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this conversation.'));
  }, [chatId, userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  // Paths already handed to the signer. A ref rather than reading
  // `mediaUrls`, which this effect also writes: depending on `mediaUrls`
  // would loop forever over any path that fails to sign, because
  // signBucketUrls omits failures from its result instead of throwing, so
  // the path would stay unsigned and re-trigger the effect on every pass.
  // Reading a ref inside an effect is fine — only during render it isn't —
  // so this needs no eslint-disable, which would make the React Compiler
  // skip the whole screen.
  const requestedPaths = useRef<Set<string>>(new Set());

  // Sign every image/voice path this conversation's currently-loaded
  // messages reference, whenever the message list changes — new sends
  // included, since sendMessage()'s own result needs a URL too.
  useEffect(() => {
    const paths = (messages ?? []).flatMap((m) => [m.image_url, m.voice_url].filter((p): p is string => !!p));
    const unsigned = paths.filter((p) => !requestedPaths.current.has(p));
    if (unsigned.length === 0) return;
    for (const path of unsigned) requestedPaths.current.add(path);
    signMessageMediaUrls(unsigned)
      .then((signed) => setMediaUrls((prev) => new Map([...prev, ...signed])))
      .catch(() => {});
  }, [messages]);

  useEffect(() => {
    if (!chatId || !userId) return;

    const unsubscribeMessages = subscribeToMessages(chatId, {
      onInsert: (message) => {
        setMessages((prev) => (prev?.some((m) => m.id === message.id) ? prev : [message, ...(prev ?? [])]));
        if (message.author_id !== userId) markConversationRead(chatId, userId).catch(() => {});
      },
      onUpdate: (message) =>
        setMessages((prev) =>
          prev && (message.deleted_at ? prev.filter((m) => m.id !== message.id) : prev.map((m) => (m.id === message.id ? message : m))),
        ),
      onReactionChange: () => fetchMessages(chatId).then(setMessages).catch(() => {}),
    });

    // One channel for both directions of typing — broadcastTyping (used
    // by handleDraftChange below) and this listener share it via
    // typingChannelRef, rather than each opening its own subscription.
    const typing = subscribeToTyping(chatId, (typingUserId) => {
      if (typingUserId === userId) return;
      setTypingUser(typingUserId);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTypingUser(null), TYPING_CLEAR_MS);
    });
    typingChannelRef.current = typing;

    return () => {
      unsubscribeMessages();
      typing.unsubscribe();
      typingChannelRef.current = null;
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [chatId, userId]);

  useEffect(() => {
    if (!chatId || summary === 'loading' || !summary || summary.kind !== 'dm' || !summary.otherUserId) return;
    return subscribeToReadReceipt(chatId, summary.otherUserId, setOtherLastRead);
  }, [chatId, summary]);

  if (!session || !userId) return null;

  function handleDraftChange(value: string) {
    setDraft(value);
    if (userId) typingChannelRef.current?.broadcastTyping(userId);
  }

  async function handleSendText() {
    if (!chatId || !userId || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft('');
    const pendingReply = replyTo;
    setReplyTo(null);
    setSending(true);
    setError(null);
    // Outside the try, and no `finally`: the React Compiler can't compile
    // `?.` inside a try, and skips a component that has a `finally`. The
    // catch handles every error, so this is equivalent — same for
    // handleAttachImage and the voice send below.
    const replyToId = pendingReply?.id;
    try {
      const sent = await sendMessage({ conversationId: chatId, authorId: userId, text, replyToId });
      setMessages((prev) => [sent, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that message.');
      setDraft(text);
    }
    setSending(false);
  }

  async function handleAttachImage() {
    if (!chatId || !userId || sending) return;
    const image = await pickImage();
    if (!image) return;
    setSending(true);
    setError(null);
    try {
      const path = await uploadMessageImage(image, chatId, userId);
      const sent = await sendMessage({ conversationId: chatId, authorId: userId, imageUrl: path });
      setMessages((prev) => [sent, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that photo.');
    }
    setSending(false);
  }

  async function handleMicPress() {
    if (!chatId || !userId || sending) return;

    if (!recording) {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      return;
    }

    await recorder.stop();
    setRecording(false);
    const uri = recorder.uri;
    if (!uri) return;

    setSending(true);
    setError(null);
    try {
      const path = await uploadMessageVoice(uri, chatId, userId);
      const sent = await sendMessage({ conversationId: chatId, authorId: userId, voiceUrl: path });
      setMessages((prev) => [sent, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that voice message.');
    }
    setSending(false);
  }

  async function handleReact(message: Message, emoji: string) {
    if (!userId) return;
    const already = message.reactions.some((r) => r.user_id === userId && r.emoji === emoji);
    try {
      if (already) await removeReaction(message.id, userId, emoji);
      else await addReaction(message.id, userId, emoji);
    } catch {
      // Reactions are a nicety, not a correctness-critical write — a
      // failed toggle just doesn't visibly change anything, no error UI.
    }
  }

  if (summary === 'loading') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        <ActivityIndicator color={colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  async function handleBlock(otherUserId: string) {
    setError(null);
    try {
      await blockUser(otherUserId);
      setBlockStatus('blocking');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not block this person.');
    }
  }

  async function handleUnblock(otherUserId: string) {
    if (!userId) return;
    setError(null);
    try {
      await unblockUser(userId, otherUserId);
      setBlockStatus('none');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unblock this person.');
    }
  }

  async function handleRemoveMessage(message: Message) {
    setError(null);
    try {
      await removeMessage(message.id);
      setMessages((prev) => prev && prev.filter((m) => m.id !== message.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that message.');
    }
  }

  async function handleToggleMute(targetUserId: string, muted: boolean) {
    if (!chatId) return;
    setError(null);
    try {
      await setMutedInChat(chatId, targetUserId, muted);
      setMutedIds((prev) => {
        const next = new Set(prev);
        if (muted) next.add(targetUserId);
        else next.delete(targetUserId);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
  }

  if (!summary) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        <Text style={styles.body}>This conversation isn&apos;t available.</Text>
      </SafeAreaView>
    );
  }

  const avatarKey = summary.kind === 'room_channel' ? (summary.room_id ?? 'grit') : (summary.otherUserId ?? 'mara');
  const subtitle =
    summary.kind === 'room_channel'
      ? summary.room_name
      : (summary.otherUserId
          ? (summary.dm_user_a === summary.otherUserId ? summary.dm_user_a_handle : summary.dm_user_b_handle)
          : null);

  const messagesById = new Map((messages ?? []).map((m) => [m.id, m]));
  const isChatMod = chatRole === 'owner' || chatRole === 'admin' || chatRole === 'mod';
  const iAmMuted = summary.kind === 'room_channel' && mutedIds.has(userId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={22} color={colors.text} />
        </Pressable>
        <Avatar gradient={avatarKey} letter={summary.title.charAt(0).toUpperCase()} shape={summary.kind === 'room_channel' ? 'square' : 'circle'} size={38} />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {summary.kind === 'room_channel' ? summary.channel_name : summary.title}
          </Text>
          {subtitle && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {summary.kind === 'dm' && summary.otherUserId && (
          <Pressable onPress={() => setOptionsOpen(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="More options">
            <Icon name="dotsH" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>

      {/* 'height' on Android, not the previous `undefined` — the manifest's
          windowSoftInputMode="adjustResize" stops actually resizing content
          under Expo's default edge-to-edge display (targeting Android 15+),
          so the composer needs its own JS-driven keyboard-height listener
          (which is what this behavior mode is) rather than relying on the
          OS to shrink the window. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={8}>
        {messages === null ? (
          <View style={[styles.flex, styles.messageList, styles.messageSkeletonList]}>
            {[
              { mine: false, width: 160 },
              { mine: true, width: 120 },
              { mine: true, width: 190 },
              { mine: false, width: 140 },
            ].map((bubble, i) => (
              <View key={i} style={bubble.mine ? styles.messageSkeletonMine : styles.messageSkeletonTheirs}>
                <Skeleton width={bubble.width} height={36} radius={16} />
              </View>
            ))}
          </View>
        ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.messageList}
          data={messages}
          inverted
          removeClippedSubviews
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={10}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const mine = item.author_id === userId;
            const showRead = mine && summary.kind === 'dm' && !!otherLastRead && otherLastRead >= item.created_at;
            const replySnippet = item.reply_to_id ? messagesById.get(item.reply_to_id) : null;
            if (summary.kind === 'room_channel' && item.author_id && blockedIds.has(item.author_id)) {
              return <Text style={styles.blockedMessage}>Message from someone you blocked</Text>;
            }
            return (
              <View>
                {replySnippet && (
                  <Text style={[styles.replyPreview, mine ? styles.replyPreviewMine : styles.replyPreviewTheirs]} numberOfLines={1}>
                    ↩ {replySnippet.text ?? (replySnippet.image_url ? 'Photo' : 'Voice message')}
                  </Text>
                )}
                <MessageBubble
                  message={item}
                  mine={mine}
                  imageUrl={item.image_url ? (mediaUrls.get(item.image_url) ?? null) : null}
                  voiceUrl={item.voice_url ? (mediaUrls.get(item.voice_url) ?? null) : null}
                  showRead={showRead}
                  onReact={(emoji) => handleReact(item, emoji)}
                  onLongPress={() => setActionsFor(item)}
                  onPress={() => setReplyTo(item)}
                />
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.body}>No messages yet — say something.</Text>
            </View>
          }
        />
        )}

        {typingUser && <Text style={styles.typingText}>Typing...</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}

        {(summary.kind === 'dm' && blockStatus !== 'none') || iAmMuted ? (
          <View style={styles.blockedBar}>
            <Text style={styles.blockedBarText}>
              {iAmMuted
                ? 'A moderator has muted you in this chat.'
                : blockStatus === 'blocking'
                  ? 'You blocked this person. Unblock them to send messages.'
                  : 'You can’t reply to this conversation.'}
            </Text>
            {blockStatus === 'blocking' && summary.otherUserId && (
              <Pressable onPress={() => summary.otherUserId && handleUnblock(summary.otherUserId)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.blockedBarAction}>Unblock</Text>
              </Pressable>
            )}
          </View>
        ) : (
        <>
        {replyTo && (
          <View style={styles.replyBanner}>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to {replyTo.author?.name ?? 'message'}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
              <Icon name="close" size={16} color={colors.neutral[400]} />
            </Pressable>
          </View>
        )}

        <View style={styles.inputBar}>
          <Pressable
            style={styles.iconButton}
            onPress={handleAttachImage}
            disabled={sending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
          >
            <Icon name="attach" size={22} color={colors.neutral[400]} />
          </Pressable>
          <View style={[styles.inputWrap, draftFocus.focused && styles.inputWrapFocused]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={handleDraftChange}
              onFocus={draftFocus.onFocus}
              onBlur={draftFocus.onBlur}
              placeholder={recording ? 'Recording...' : 'Message'}
              placeholderTextColor={colors.neutral[500]}
              editable={!recording}
              multiline
            />
          </View>
          <Pressable
            style={[styles.sendButton, recording && styles.sendButtonRecording]}
            onPress={draft.trim() ? handleSendText : handleMicPress}
            disabled={sending && !recording}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={draft.trim() ? 'Send message' : recording ? 'Stop recording' : 'Record a voice message'}
          >
            {sending && !recording ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Icon name={draft.trim() ? 'send' : recording ? 'check' : 'mic'} size={19} color={colors.bg} />
            )}
          </Pressable>
        </View>
        </>
        )}
      </KeyboardAvoidingView>

      <OptionsSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        options={(() => {
          const target = actionsFor;
          if (!target) return [];
          const mine = target.author_id === userId;
          const name = target.author?.name ?? 'this person';
          const targetMuted = !!target.author_id && mutedIds.has(target.author_id);
          return [
            {
              key: 'like',
              label: 'Like',
              icon: 'heart' as const,
              onPress: () => {
                setActionsFor(null);
                handleReact(target, '❤️');
              },
            },
            ...(mine
              ? [
                  {
                    key: 'delete',
                    label: 'Delete message',
                    icon: 'trash' as const,
                    destructive: true,
                    onPress: () => {
                      setActionsFor(null);
                      setRemovingMessage(target);
                    },
                  },
                ]
              : []),
            ...(!mine
              ? [
                  {
                    key: 'report',
                    label: 'Report message',
                    icon: 'alertCircle' as const,
                    destructive: true,
                    onPress: () => {
                      setActionsFor(null);
                      setReportTarget({
                        type: 'message',
                        id: target.id,
                        noun: 'message',
                        blockUser:
                          target.author_id && target.author
                            ? { id: target.author_id, handle: target.author.handle }
                            : undefined,
                      });
                    },
                  },
                ]
              : []),
            ...(!mine && summary.kind === 'room_channel' && isChatMod
              ? [
                  {
                    key: 'remove',
                    label: 'Remove message',
                    icon: 'trash' as const,
                    destructive: true,
                    onPress: () => {
                      setActionsFor(null);
                      setRemovingMessage(target);
                    },
                  },
                  ...(target.author_id
                    ? [
                        {
                          key: 'mute',
                          label: targetMuted ? `Unmute ${name} in this chat` : `Mute ${name} in this chat`,
                          icon: 'lock' as const,
                          destructive: !targetMuted,
                          onPress: () => {
                            setActionsFor(null);
                            if (target.author_id) handleToggleMute(target.author_id, !targetMuted);
                          },
                        },
                      ]
                    : []),
                ]
              : []),
          ];
        })()}
      />
      <ReportSheet
        target={reportTarget}
        onBlocked={() => setBlockedViaReport(true)}
        onClose={() => {
          setReportTarget(null);
          if (blockedViaReport) {
            setBlockedViaReport(false);
            load();
          }
        }}
      />
      <ConfirmModal
        visible={removingMessage !== null}
        title={removingMessage?.author_id === userId ? 'Delete this message?' : 'Remove this message?'}
        body={
          removingMessage?.author_id === userId
            ? "It'll be removed for everyone in this chat."
            : "It'll be removed for everyone in this chat and recorded in the Room's moderation log."
        }
        confirmLabel={removingMessage?.author_id === userId ? 'Delete' : 'Remove'}
        onCancel={() => setRemovingMessage(null)}
        onConfirm={() => {
          const target = removingMessage;
          setRemovingMessage(null);
          if (target) handleRemoveMessage(target);
        }}
      />

      {summary.kind === 'dm' && summary.otherUserId && (
        <>
          <OptionsSheet
            visible={optionsOpen}
            onClose={() => setOptionsOpen(false)}
            options={[
              {
                key: 'report',
                label: `Report @${subtitle ?? ''}`,
                icon: 'alertCircle',
                destructive: true,
                onPress: () => {
                  setOptionsOpen(false);
                  if (summary.otherUserId) {
                    setReportTarget({
                      type: 'user',
                      id: summary.otherUserId,
                      noun: `@${subtitle ?? ''}`,
                      blockUser: blockStatus === 'blocking' ? undefined : { id: summary.otherUserId, handle: subtitle ?? '' },
                    });
                  }
                },
              },
              blockStatus === 'blocking'
                ? {
                    key: 'unblock',
                    label: `Unblock @${subtitle ?? ''}`,
                    icon: 'noEntry',
                    onPress: () => {
                      setOptionsOpen(false);
                      if (summary.otherUserId) handleUnblock(summary.otherUserId);
                    },
                  }
                : {
                    key: 'block',
                    label: `Block @${subtitle ?? ''}`,
                    icon: 'noEntry',
                    destructive: true,
                    onPress: () => {
                      setOptionsOpen(false);
                      setConfirmingBlock(true);
                    },
                  },
            ]}
          />
          <BlockConfirmModal
            visible={confirmingBlock}
            handle={subtitle ?? ''}
            onCancel={() => setConfirmingBlock(false)}
            onConfirm={() => {
              setConfirmingBlock(false);
              if (summary.otherUserId) handleBlock(summary.otherUserId);
            }}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  blockedMessage: {
    alignSelf: 'flex-start',
    marginVertical: Spacing[1],
    marginHorizontal: Spacing[4],
    fontFamily: Fonts.body,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.neutral[500],
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[6],
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  blockedBarText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  blockedBarAction: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  messageSkeletonList: {
    gap: Spacing[2],
  },
  messageSkeletonMine: {
    alignSelf: 'flex-end',
  },
  messageSkeletonTheirs: {
    alignSelf: 'flex-start',
  },
  messageList: {
    padding: Spacing[4],
    flexGrow: 1,
    justifyContent: 'flex-end',
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  replyPreview: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: colors.neutral[500],
    marginBottom: 2,
  },
  replyPreviewMine: {
    textAlign: 'right',
    marginRight: 6,
  },
  replyPreviewTheirs: {
    marginLeft: 36,
  },
  typingText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[500],
    paddingHorizontal: Spacing[4],
    paddingBottom: 4,
  },
  errorText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[4],
    paddingBottom: 4,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.divider,
  },
  replyBannerText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: colors.neutral[400],
    flex: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingTop: 10,
    paddingBottom: Spacing[6],
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.divider,
  },
  iconButton: {
    height: 42,
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderRadius: 21,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  inputWrapFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  input: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.text,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonRecording: {
    backgroundColor: colors.accent[600],
  },
});
