import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedMedia } from '@/lib/media';
import {
  clampPhotoFocus,
  feedShapeAspectRatio,
  loadPhotoForEditing,
  MAX_PHOTO_ZOOM,
  UNEDITED_PHOTO,
  type FeedShape,
  type PhotoEdit,
  type PickedImage,
} from '@/lib/mediaUtils';

export type EditablePhoto = Extract<PickedMedia, { kind: 'image' }>;
export type EditableClip = Extract<PickedMedia, { kind: 'video' }>;

const SHAPE_OPTIONS: { shape: FeedShape; label: string }[] = [
  { shape: 'square', label: 'Square' },
  { shape: 'portrait', label: 'Portrait' },
  { shape: 'landscape', label: 'Landscape' },
];

/** Gap between the crop frame and the stage's edges, so the frame reads as a frame rather than the screen's edge. */
const FRAME_INSET = Spacing[4];

/**
 * The Post composer's photo editor: crop (drag to move, pinch to zoom,
 * inside a frame of one of the app's three post shapes), rotate a quarter
 * turn, flip, reset.
 *
 * Nothing is rendered to a file here. The editor only produces a
 * `PhotoEdit` — rotation, flip, and a crop stored relative to the photo —
 * and create-post.tsx renders the preview from it, while the upload later
 * renders the same edit from the full-size original (lib/mediaUtils.ts).
 * So this screen works on a downscaled copy for speed without the upload
 * ever losing resolution for it.
 *
 * Geometry, all in screen points unless noted: the frame is centered in
 * the stage; at zoom 1 the crop is the largest rect of the shape that fits
 * the (rotated) photo, so `baseScale` maps photo pixels to points such that
 * that crop exactly fills the frame. The photo layer is laid out at that
 * scale, then scaled by `zoom` about its center and translated so the crop
 * center sits at the stage's center. Rotation and flip are nested views
 * inside that layer, so their order matches the manipulator's (rotate
 * first, then mirror what you see) without depending on how a single
 * transform array composes.
 *
 * Pan and pinch run as worklets on the UI thread and only ever write shared
 * values — no React state per frame — which is what keeps dragging smooth
 * on a low-end phone.
 *
 * Clips use the same editor for their feed framing (shape + drag/pinch).
 * The video plays muted inside the frame; there's no rotate/flip (phone
 * video is already upright, and nothing re-encodes it). The geometry runs
 * on the clip's displayed aspect in abstract units instead of photo pixels
 * — the result is the same relative crop, stored as the clip's framing
 * (20260917100000_clip_framing.sql) rather than rendered into a file.
 */
export default function PhotoEditor({
  media,
  videoAspect,
  initialShape,
  isCarousel,
  busy,
  error,
  onCancel,
  onDone,
}: {
  media: EditablePhoto | EditableClip;
  /** Clips only: the video's displayed (rotation-corrected) width / height. */
  videoAspect?: number;
  initialShape: FeedShape;
  /** Whether the post has more than one item — shows that the shape applies to all of them. */
  isCarousel: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDone: (edit: PhotoEdit, shape: FeedShape) => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isClip = media.kind === 'video';
  const startingEdit: PhotoEdit =
    media.kind === 'video'
      ? media.framing
        ? { rotation: 0, flipped: false, zoom: media.framing.zoom, focusX: media.framing.focusX, focusY: media.framing.focusY }
        : UNEDITED_PHOTO
      : (media.edit ?? UNEDITED_PHOTO);

  const [shape, setShape] = useState(initialShape);
  const [rotation, setRotation] = useState(startingEdit.rotation);
  const [flipped, setFlipped] = useState(startingEdit.flipped);
  const [workingImage, setWorkingImage] = useState<PickedImage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // A clip needs no decoded copy: its "working size" is just its aspect in
  // abstract units (1000 tall), which is all the frame geometry uses.
  const working: PickedImage | null =
    media.kind === 'video' ? (videoAspect ? { uri: media.uri, width: videoAspect * 1000, height: 1000 } : null) : workingImage;
  const [stageWidth, setStageWidth] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);

  const zoom = useSharedValue(startingEdit.zoom);
  const focusX = useSharedValue(startingEdit.focusX);
  const focusY = useSharedValue(startingEdit.focusY);
  const lastPanX = useSharedValue(0);
  const lastPanY = useSharedValue(0);
  const lastPinchScale = useSharedValue(1);

  useEffect(() => {
    if (media.kind !== 'image') return;
    let cancelled = false;
    loadPhotoForEditing(media)
      .then((image) => {
        if (!cancelled) setWorkingImage(image);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [media]);

  const aspectRatio = feedShapeAspectRatio(shape);
  const quarterTurn = rotation === 90 || rotation === 270;
  // The photo as the crop sees it — rotated (a flip doesn't change size) — in the working copy's pixels.
  const imageWidth = working ? (quarterTurn ? working.height : working.width) : 0;
  const imageHeight = working ? (quarterTurn ? working.width : working.height) : 0;
  const frameWidth = Math.max(Math.min(stageWidth - FRAME_INSET * 2, (stageHeight - FRAME_INSET * 2) * aspectRatio), 0);
  const frameHeight = frameWidth / aspectRatio;
  const frameLeft = (stageWidth - frameWidth) / 2;
  const frameTop = (stageHeight - frameHeight) / 2;
  const baseScale = imageWidth > 0 ? frameWidth / Math.min(imageWidth, imageHeight * aspectRatio) : 0;
  const displayWidth = imageWidth * baseScale;
  const displayHeight = imageHeight * baseScale;
  const ready = working !== null && baseScale > 0;

  // Shared values go through get()/set() rather than `.value` throughout
  // this file: the React Compiler's lint rejects writing `.value` from
  // functions it can't prove only run outside render (Reanimated's
  // documented compiler-compatible form).
  const photoTransformStyle = useAnimatedStyle(() => {
    const scale = zoom.get();
    const [x, y] = clampPhotoFocus(focusX.get(), focusY.get(), scale, imageWidth || 1, imageHeight || 1, aspectRatio);
    return {
      transform: [
        { translateX: stageWidth / 2 - displayWidth / 2 - (x - 0.5) * displayWidth * scale },
        { translateY: stageHeight / 2 - displayHeight / 2 - (y - 0.5) * displayHeight * scale },
        { scale },
      ],
    };
  });

  const pan = Gesture.Pan()
    .enabled(ready && !busy)
    .maxPointers(2)
    .onStart(() => {
      lastPanX.set(0);
      lastPanY.set(0);
    })
    .onUpdate((event) => {
      const pointsPerPixel = baseScale * zoom.get();
      const dx = event.translationX - lastPanX.get();
      const dy = event.translationY - lastPanY.get();
      lastPanX.set(event.translationX);
      lastPanY.set(event.translationY);
      // Dragging the photo right moves the crop left across it.
      const [x, y] = clampPhotoFocus(
        focusX.get() - dx / pointsPerPixel / imageWidth,
        focusY.get() - dy / pointsPerPixel / imageHeight,
        zoom.get(),
        imageWidth,
        imageHeight,
        aspectRatio,
      );
      focusX.set(x);
      focusY.set(y);
    });

  const pinch = Gesture.Pinch()
    .enabled(ready && !busy)
    .onStart(() => {
      lastPinchScale.set(1);
    })
    .onUpdate((event) => {
      const previousZoom = zoom.get();
      const nextZoom = Math.min(Math.max(previousZoom * (event.scale / lastPinchScale.get()), 1), MAX_PHOTO_ZOOM);
      lastPinchScale.set(event.scale);
      // Zoom about the fingers, not the frame's center: whatever part of the
      // photo is under the fingers stays under them.
      const offsetX = event.focalX - stageWidth / 2;
      const offsetY = event.focalY - stageHeight / 2;
      const shiftX = (offsetX / (baseScale * previousZoom) - offsetX / (baseScale * nextZoom)) / imageWidth;
      const shiftY = (offsetY / (baseScale * previousZoom) - offsetY / (baseScale * nextZoom)) / imageHeight;
      zoom.set(nextZoom);
      const [x, y] = clampPhotoFocus(focusX.get() + shiftX, focusY.get() + shiftY, nextZoom, imageWidth, imageHeight, aspectRatio);
      focusX.set(x);
      focusY.set(y);
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  function handleStageLayout(event: LayoutChangeEvent) {
    setStageWidth(event.nativeEvent.layout.width);
    setStageHeight(event.nativeEvent.layout.height);
  }

  function selectShape(next: FeedShape) {
    setShape(next);
    if (!working) return;
    const [x, y] = clampPhotoFocus(focusX.get(), focusY.get(), zoom.get(), imageWidth, imageHeight, feedShapeAspectRatio(next));
    focusX.set(x);
    focusY.set(y);
  }

  function rotate() {
    setRotation((current) => ((current + 90) % 360) as PhotoEdit['rotation']);
    // A quarter turn swaps which way the photo is long — start the crop
    // over rather than guess where the old one should land.
    zoom.set(1);
    focusX.set(0.5);
    focusY.set(0.5);
  }

  function flip() {
    setFlipped((current) => !current);
    // Keep the same part of the photo in the frame, now mirrored.
    focusX.set((current) => 1 - current);
  }

  function reset() {
    setRotation(0);
    setFlipped(false);
    zoom.set(1);
    focusX.set(0.5);
    focusY.set(0.5);
  }

  function handleDone() {
    if (!ready) return;
    const [x, y] = clampPhotoFocus(focusX.get(), focusY.get(), zoom.get(), imageWidth, imageHeight, aspectRatio);
    onDone({ rotation, flipped, zoom: zoom.get(), focusX: x, focusY: y }, shape);
  }

  const controlsDisabled = !ready || busy;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel editing">
          <Icon name="close" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{isClip ? 'Edit clip' : 'Edit photo'}</Text>
        <Pressable onPress={handleDone} disabled={controlsDisabled} hitSlop={8} accessibilityRole="button">
          {busy ? (
            <ActivityIndicator color={colors.accent.DEFAULT} />
          ) : (
            <Text style={[styles.done, !ready && styles.doneDisabled]}>Done</Text>
          )}
        </Pressable>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={styles.stage} onLayout={handleStageLayout}>
          {ready && working ? (
            <>
              <Animated.View style={[styles.photoLayer, { width: displayWidth, height: displayHeight }, photoTransformStyle]}>
                <View style={[StyleSheet.absoluteFill, flipped && styles.mirrored]}>
                  {isClip ? (
                    <EditorClipVideo uri={working.uri} />
                  ) : (
                    <Image
                      source={{ uri: working.uri }}
                      // Decode at full working resolution, not at this view's
                      // unzoomed size, so the photo stays sharp when zoomed in.
                      allowDownscaling={false}
                      contentFit="fill"
                      style={{
                        position: 'absolute',
                        width: working.width * baseScale,
                        height: working.height * baseScale,
                        left: (displayWidth - working.width * baseScale) / 2,
                        top: (displayHeight - working.height * baseScale) / 2,
                        transform: [{ rotate: `${rotation}deg` }],
                      }}
                      accessibilityLabel="Photo being cropped. Drag to move it, pinch to zoom."
                    />
                  )}
                </View>
              </Animated.View>

              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[styles.shade, { left: 0, right: 0, top: 0, height: frameTop }]} />
                <View style={[styles.shade, { left: 0, right: 0, top: frameTop + frameHeight, bottom: 0 }]} />
                <View style={[styles.shade, { left: 0, width: frameLeft, top: frameTop, height: frameHeight }]} />
                <View style={[styles.shade, { right: 0, width: frameLeft, top: frameTop, height: frameHeight }]} />
                <View style={[styles.frame, { left: frameLeft, top: frameTop, width: frameWidth, height: frameHeight }]}>
                  <View style={[styles.gridLine, styles.gridVertical, { left: frameWidth / 3 }]} />
                  <View style={[styles.gridLine, styles.gridVertical, { left: (frameWidth * 2) / 3 }]} />
                  <View style={[styles.gridLine, styles.gridHorizontal, { top: frameHeight / 3 }]} />
                  <View style={[styles.gridLine, styles.gridHorizontal, { top: (frameHeight * 2) / 3 }]} />
                </View>
              </View>
            </>
          ) : loadFailed ? (
            <Text style={styles.message}>Couldn&apos;t open this photo for editing.</Text>
          ) : isClip && !videoAspect ? (
            <Text style={styles.message}>Couldn&apos;t read this clip&apos;s size yet — try again in a moment.</Text>
          ) : (
            <ActivityIndicator color={colors.accent.DEFAULT} />
          )}
        </View>
      </GestureDetector>

      <View style={styles.controls}>
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.shapeRow} accessibilityRole="radiogroup">
          {SHAPE_OPTIONS.map((option) => {
            const selected = option.shape === shape;
            return (
              <Pressable
                key={option.shape}
                style={[styles.shapePill, selected && styles.shapePillSelected]}
                onPress={() => selectShape(option.shape)}
                disabled={controlsDisabled}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: controlsDisabled }}
              >
                <Text style={[styles.shapeLabel, selected && styles.shapeLabelSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {isCarousel && <Text style={styles.note}>Every photo in this post uses the same shape.</Text>}
        {isClip && <Text style={styles.note}>This is how the clip shows in the feed. Opening it plays the whole video.</Text>}

        <View style={styles.toolRow}>
          {!isClip && <ToolButton icon="rotateCw" label="Rotate" onPress={rotate} disabled={controlsDisabled} />}
          {!isClip && <ToolButton icon="flipHorizontal" label="Flip" onPress={flip} disabled={controlsDisabled} />}
          <ToolButton icon="undo" label="Reset" onPress={reset} disabled={controlsDisabled} />
        </View>
      </View>
    </View>
  );
}

/**
 * The clip playing muted inside the editor's frame. It fills the photo layer
 * (sized to the clip's aspect), so the layer's pan/zoom transform frames it
 * exactly like a photo. textureView: Android's default SurfaceView ignores
 * the transform and clipping the frame relies on.
 */
function EditorClipVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      surfaceType="textureView"
      accessibilityLabel="Clip being framed. Drag to move it, pinch to zoom."
    />
  );
}

function ToolButton({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled: boolean }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.tool, disabled && styles.toolDisabled]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={colors.text} />
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing[6],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[4],
    },
    title: {
      fontFamily: Fonts.heading,
      fontSize: 16,
      color: colors.text,
    },
    done: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.accent.DEFAULT,
    },
    doneDisabled: {
      opacity: 0.35,
    },
    stage: {
      flex: 1,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoLayer: {
      position: 'absolute',
      left: 0,
      top: 0,
    },
    mirrored: {
      transform: [{ scaleX: -1 }],
    },
    shade: {
      position: 'absolute',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    frame: {
      position: 'absolute',
      borderWidth: 1,
      borderColor: '#ffffff',
    },
    gridLine: {
      position: 'absolute',
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    gridVertical: {
      top: 0,
      bottom: 0,
      width: StyleSheet.hairlineWidth,
    },
    gridHorizontal: {
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
    },
    message: {
      fontFamily: Fonts.body,
      fontSize: 14,
      color: colors.neutral[500],
      textAlign: 'center',
      paddingHorizontal: Spacing[6],
    },
    controls: {
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[4],
      gap: Spacing[3],
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.accent.DEFAULT,
      textAlign: 'center',
    },
    shapeRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: Spacing[2],
    },
    shapePill: {
      height: 36,
      paddingHorizontal: 16,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shapePillSelected: {
      backgroundColor: colors.text,
    },
    shapeLabel: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.text,
    },
    shapeLabelSelected: {
      color: colors.bg,
    },
    note: {
      fontFamily: Fonts.body,
      fontSize: 12,
      color: colors.neutral[500],
      textAlign: 'center',
    },
    toolRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    tool: {
      minWidth: 64,
      alignItems: 'center',
      gap: Spacing[1],
      paddingVertical: Spacing[1],
    },
    toolDisabled: {
      opacity: 0.35,
    },
    toolLabel: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 12,
      color: colors.text,
    },
  });
