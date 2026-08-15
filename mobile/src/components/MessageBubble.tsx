import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { Message } from '@/lib/chat';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function VoicePlayer({ uri, mine }: { uri: string; mine: boolean }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  return (
    <Pressable
      style={styles.voiceRow}
      onPress={() => (status.playing ? player.pause() : player.play())}
      hitSlop={8}
    >
      <View style={[styles.voicePlayButton, mine && styles.voicePlayButtonMine]}>
        <Icon name={status.playing ? 'pause' : 'play'} size={14} color={mine ? Colors.bg : Colors.text} filled />
      </View>
      <View style={[styles.voiceTrack, mine && styles.voiceTrackMine]}>
        <View
          style={[
            styles.voiceProgress,
            mine && styles.voiceProgressMine,
            { width: `${status.duration ? Math.min(100, (status.currentTime / status.duration) * 100) : 0}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

export default function MessageBubble({
  message,
  mine,
  imageUrl,
  voiceUrl,
  showRead,
  onReact,
  onPress,
}: {
  message: Message;
  mine: boolean;
  imageUrl: string | null;
  voiceUrl: string | null;
  /** DM-only — see lib/chat.ts's comment on why per-message read receipts aren't shown in Room channels. */
  showRead: boolean;
  onReact: (emoji: string) => void;
  onPress: () => void;
}) {
  const reactionCounts = new Map<string, number>();
  for (const r of message.reactions) reactionCounts.set(r.emoji, (reactionCounts.get(r.emoji) ?? 0) + 1);

  if (mine) {
    return (
      <View style={styles.mineWrap}>
        {/* One Pressable owning both gestures, not two nested ones — a
            Pressable with only onLongPress still claims (and swallows) a
            plain tap even though it has nothing to do with it, which is
            exactly what silently broke reply-to here before: the outer
            screen's onPress never got the touch. */}
        <Pressable onPress={onPress} onLongPress={() => onReact('❤️')}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.mineImage} />
          ) : voiceUrl ? (
            <View style={[styles.bubble, styles.mineBubble, styles.voiceBubble]}>
              <VoicePlayer uri={voiceUrl} mine />
            </View>
          ) : (
            <View style={[styles.bubble, styles.mineBubble]}>
              <Text style={styles.mineText}>{message.text}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.mineMetaRow}>
          <Text style={styles.metaText}>{formatTime(message.created_at)}</Text>
          {showRead && <Icon name="checkDouble" size={14} color={Colors.accent2[300]} strokeWidth={2.6} />}
        </View>
        {reactionCounts.size > 0 && (
          <View style={styles.reactionRow}>
            {[...reactionCounts.entries()].map(([emoji, count]) => (
              <Text key={emoji} style={styles.reactionPill}>
                {emoji} {count > 1 ? count : ''}
              </Text>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.theirsWrap}>
      <Avatar gradient={message.author_id ?? 'mara'} letter={(message.author?.name ?? '?').charAt(0)} size={28} />
      <View style={styles.theirsContent}>
        <Pressable onPress={onPress} onLongPress={() => onReact('❤️')}>
          {imageUrl ? (
            <View style={styles.theirsImageWrap}>
              <Image source={{ uri: imageUrl }} style={styles.theirsImage} />
              <Text style={styles.imageTime}>{formatTime(message.created_at)}</Text>
            </View>
          ) : voiceUrl ? (
            <View style={[styles.bubble, styles.theirsBubble, styles.voiceBubble]}>
              <VoicePlayer uri={voiceUrl} mine={false} />
            </View>
          ) : (
            <View style={[styles.bubble, styles.theirsBubble]}>
              <Text style={styles.theirsText}>
                {message.text}
                <Text style={styles.inlineTime}>  {formatTime(message.created_at)}</Text>
              </Text>
            </View>
          )}
        </Pressable>
        {reactionCounts.size > 0 && (
          <View style={styles.reactionRow}>
            {[...reactionCounts.entries()].map(([emoji, count]) => (
              <Text key={emoji} style={styles.reactionPill}>
                {emoji} {count > 1 ? count : ''}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mineWrap: {
    alignSelf: 'flex-end',
    maxWidth: '75%',
    marginVertical: 4,
  },
  theirsWrap: {
    flexDirection: 'row',
    gap: Spacing[2],
    alignItems: 'flex-end',
    marginVertical: 4,
    maxWidth: '85%',
  },
  theirsContent: {
    flex: 1,
  },
  bubble: {
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  mineBubble: {
    backgroundColor: Colors.accent.DEFAULT,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  theirsBubble: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
  },
  mineText: {
    fontFamily: Fonts.body,
    fontSize: 14.5,
    lineHeight: 20,
    color: Colors.bg,
  },
  theirsText: {
    fontFamily: Fonts.body,
    fontSize: 14.5,
    lineHeight: 20,
    color: Colors.text,
  },
  inlineTime: {
    fontSize: 10.5,
    color: Colors.neutral[500],
  },
  mineMetaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingRight: 4,
  },
  metaText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.neutral[500],
  },
  mineImage: {
    width: 200,
    height: 150,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  theirsImageWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 5,
    width: 200,
  },
  theirsImage: {
    width: '100%',
    height: 150,
    borderRadius: 14,
    backgroundColor: Colors.neutral[800],
  },
  imageTime: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.neutral[500],
    textAlign: 'right',
    paddingTop: 5,
    paddingRight: 2,
  },
  voiceBubble: {
    minWidth: 160,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  voicePlayButton: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePlayButtonMine: {
    backgroundColor: Colors.bg,
  },
  voiceTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  voiceTrackMine: {
    backgroundColor: 'rgba(29,36,21,0.3)',
  },
  voiceProgress: {
    height: '100%',
    backgroundColor: Colors.accent2.DEFAULT,
  },
  voiceProgressMine: {
    backgroundColor: Colors.bg,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  reactionPill: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: `${Colors.accent.DEFAULT}33`,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
