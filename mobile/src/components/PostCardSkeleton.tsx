import { StyleSheet, View } from 'react-native';

import Skeleton from '@/components/Skeleton';
import { Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Shaped after PostCard.tsx's own layout (38px avatar, name/time lines, a
 * body block) — used wherever a screen loads a list or single instance of
 * real posts, so the loading state holds the same rhythm as what's about
 * to replace it instead of a screen-wide spinner. `bodyHeight` varies by
 * caller: a feed's cards are shorter and more numerous, a post-detail
 * screen's single hero image is taller.
 */
export default function PostCardSkeleton({ bodyHeight = 160 }: { bodyHeight?: number }) {
  const colors = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.authorRow}>
        <Skeleton width={38} height={38} radius={999} />
        <View style={styles.authorText}>
          <Skeleton width={120} height={13} radius={6} />
          <Skeleton width={70} height={11} radius={5} />
        </View>
      </View>
      <Skeleton width="100%" height={bodyHeight} radius={Radius.md} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: Spacing[4],
      paddingVertical: Spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    authorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      marginBottom: Spacing[3],
    },
    authorText: {
      flex: 1,
      gap: 5,
    },
  });
