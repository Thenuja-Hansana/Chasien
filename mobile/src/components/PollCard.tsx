import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { Poll } from '@/lib/posts';

/**
 * Ported from app_reference/src/screens/Home.jsx's PollCard, with two
 * deliberate differences now that votes are real rather than local state:
 *
 * 1. Votes are optimistic — the bar moves on tap, then reverts if the
 *    write fails. A real network round trip between tap and feedback is
 *    the one thing the mock never had to account for.
 * 2. A vote can be changed. The mock hard-locks after the first tap
 *    (`if (voted !== null) return`), which is fine for a static demo but
 *    would permanently strand a real mis-tap; the schema explicitly
 *    permits retracting ("users can retract their own vote",
 *    row_level_security.sql), so the UI honours that.
 */
export default function PollCard({ poll, onVote }: { poll: Poll; onVote: (optionId: string) => Promise<void> }) {
  const [optimistic, setOptimistic] = useState<Poll>(poll);
  const [busy, setBusy] = useState(false);

  // The feed refetches after a vote, so `poll` is the source of truth
  // whenever it changes underneath us; local state exists only to cover
  // the gap between tap and that refetch.
  const current = busy ? optimistic : poll;

  async function handleVote(optionId: string) {
    if (busy || optionId === poll.myOptionId) return;

    const previous = poll.myOptionId;
    setOptimistic({
      ...poll,
      myOptionId: optionId,
      totalVotes: poll.totalVotes + (previous ? 0 : 1),
      options: poll.options.map((o) => ({
        ...o,
        votes: o.votes + (o.id === optionId ? 1 : o.id === previous ? -1 : 0),
      })),
    });
    setBusy(true);
    try {
      await onVote(optionId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.question}>{current.question}</Text>
      <View style={styles.options}>
        {current.options.map((option) => {
          const isMine = option.id === current.myOptionId;
          const pct = current.totalVotes > 0 ? Math.round((option.votes / current.totalVotes) * 100) : 0;
          return (
            <Pressable key={option.id} style={styles.option} onPress={() => handleVote(option.id)} disabled={busy}>
              <View style={[styles.fill, { width: `${pct}%` }, isMine && styles.fillMine]} />
              <View style={styles.optionRow}>
                <Text style={styles.optionLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                <Text style={styles.optionVotes}>{option.votes}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.total}>
        {current.totalVotes} {current.totalVotes === 1 ? 'vote' : 'votes'}
        {current.myOptionId ? ' · tap another option to change your vote' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  question: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.text,
    marginBottom: Spacing[2],
  },
  options: {
    gap: 7,
  },
  option: {
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: `${Colors.text}12`,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: `${Colors.accent.DEFAULT}57`,
  },
  fillMine: {
    backgroundColor: `${Colors.accent.DEFAULT}70`,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    gap: Spacing[2],
  },
  optionLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemibold,
    fontSize: 12,
    color: Colors.text,
  },
  optionVotes: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 12,
    color: Colors.text,
  },
  total: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.neutral[500],
    marginTop: Spacing[2],
  },
});
