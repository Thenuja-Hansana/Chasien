import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pressable, StyleSheet, View } from 'react-native';

import Icon from '@/components/Icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedMedia } from '@/lib/media';

/**
 * A paused, no-controls video preview (this is a picker tile, not a
 * player) with a centered play glyph standing in for a real poster frame
 * — this app has no thumbnail-extraction step and doesn't need one for an
 * ephemeral composer preview. Used by the Clip tab's preview below; the
 * Post tab previews through the feed's own PostMediaCarousel instead (see
 * PostTabFields.tsx), which replaced its old thumbnail strip.
 */
function MediaVisual({ media }: { media: PickedMedia }) {
  if (media.kind === 'video') return <VideoVisual uri={media.uri} />;
  return <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

function VideoVisual({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <View pointerEvents="none" style={styles.playBadge}>
        <Icon name="play" size={16} color="#ffffff" />
      </View>
    </>
  );
}

/** The Clip tab's single, full-width portrait preview, with a remove button. */
export function ComposerMediaPreview({ media, onRemove, disabled }: { media: PickedMedia; onRemove: () => void; disabled: boolean }) {
  const colors = useTheme();
  return (
    <View style={[styles.preview, { backgroundColor: colors.surface }]}>
      <MediaVisual media={media} />
      <Pressable style={styles.remove} onPress={onRemove} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove">
        <Icon name="close" size={15} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  playBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
