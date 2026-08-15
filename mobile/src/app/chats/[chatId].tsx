import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import MessageBubble from '@/components/MessageBubble';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
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
import { signMessageMediaUrls, uploadMessageImage, uploadMessageVoice } from '@/lib/messageMedia';

const TYPING_CLEAR_MS = 3000;

export default function ChatView() {
  const { session } = useAuth();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const userId = session?.user.id;

  const [summary, setSummary] = useState<InboxItem | null | 'loading'>('loading');
  const [messages, setMessages] = useState<Message[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof subscribeToTyping> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const load = useCallback(() => {
    if (!chatId || !userId) return;
    setSummary('loading');
    fetchConversationSummary(chatId, userId)
      .then(async (s) => {
        setSummary(s);
        if (!s) return;
        const rows = await fetchMessages(chatId);
        setMessages(rows);
        await markConversationRead(chatId, userId);
        if (s.kind === 'dm' && s.otherUserId) {
          setOtherLastRead(await fetchOtherParticipantLastRead(chatId, s.otherUserId));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this conversation.'));
  }, [chatId, userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  // Sign every image/voice path this conversation's currently-loaded
  // messages reference, whenever the message list changes — new sends
  // included, since sendMessage()'s own result needs a URL too.
  useEffect(() => {
    const paths = messages.flatMap((m) => [m.image_url, m.voice_url].filter((p): p is string => !!p));
    const unsigned = paths.filter((p) => !mediaUrls.has(p));
    if (unsigned.length === 0) return;
    signMessageMediaUrls(unsigned).then((signed) => setMediaUrls((prev) => new Map([...prev, ...signed])));
    // mediaUrls intentionally excluded — it's the thing this effect
    // grows, not something a change to it should re-run the effect for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (!chatId || !userId) return;

    const unsubscribeMessages = subscribeToMessages(chatId, {
      onInsert: (message) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [message, ...prev]));
        if (message.author_id !== userId) markConversationRead(chatId, userId).catch(() => {});
      },
      onUpdate: (message) => setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m))),
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
    try {
      const sent = await sendMessage({ conversationId: chatId, authorId: userId, text, replyToId: pendingReply?.id });
      setMessages((prev) => [sent, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that message.');
      setDraft(text);
    } finally {
      setSending(false);
    }
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
      setMessages((prev) => [sent, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that photo.');
    } finally {
      setSending(false);
    }
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
      setMessages((prev) => [sent, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that voice message.');
    } finally {
      setSending(false);
    }
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
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
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

  const messagesById = new Map(messages.map((m) => [m.id, m]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={Colors.text} />
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
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.messageList}
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const mine = item.author_id === userId;
            const showRead = mine && summary.kind === 'dm' && !!otherLastRead && otherLastRead >= item.created_at;
            const replySnippet = item.reply_to_id ? messagesById.get(item.reply_to_id) : null;
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

        {typingUser && <Text style={styles.typingText}>Typing...</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}

        {replyTo && (
          <View style={styles.replyBanner}>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to {replyTo.author?.name ?? 'message'}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Icon name="close" size={16} color={Colors.neutral[400]} />
            </Pressable>
          </View>
        )}

        <View style={styles.inputBar}>
          <Pressable style={styles.iconButton} onPress={handleAttachImage} disabled={sending}>
            <Icon name="attach" size={22} color={Colors.neutral[400]} />
          </Pressable>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={handleDraftChange}
              placeholder={recording ? 'Recording...' : 'Message'}
              placeholderTextColor={Colors.neutral[500]}
              editable={!recording}
              multiline
            />
          </View>
          <Pressable
            style={[styles.sendButton, recording && styles.sendButtonRecording]}
            onPress={draft.trim() ? handleSendText : handleMicPress}
            disabled={sending && !recording}
          >
            {sending && !recording ? (
              <ActivityIndicator size="small" color={Colors.bg} />
            ) : (
              <Icon name={draft.trim() ? 'send' : recording ? 'check' : 'mic'} size={19} color={Colors.bg} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
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
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
    borderColor: Colors.divider,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  headerSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.neutral[400],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  messageList: {
    padding: Spacing[4],
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  replyPreview: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.neutral[500],
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
    color: Colors.neutral[500],
    paddingHorizontal: Spacing[4],
    paddingBottom: 4,
  },
  errorText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.accent.DEFAULT,
    paddingHorizontal: Spacing[4],
    paddingBottom: 4,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderColor: Colors.divider,
  },
  replyBannerText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.neutral[400],
    flex: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingTop: 10,
    paddingBottom: Spacing[6],
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderColor: Colors.divider,
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
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  input: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.text,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonRecording: {
    backgroundColor: Colors.accent[600],
  },
});
