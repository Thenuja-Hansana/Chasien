import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedMedia } from '@/lib/media';

// LayoutAnimation drives every collapse/expand transition in this file
// (scroll-collapsing the camera, maximize/minimize) — it hands the whole
// before/after layout transition to the native side with no per-frame JS
// involvement, which is what actually gets Instagram-level smoothness on a
// budget device; a JS-driven Animated.timing on a layout property like
// height/maxHeight round-trips through the JS thread every frame and was
// the source of the jank this replaces. Old Android + JS engine combos
// needed this opt-in; on this app's architecture it's a no-op guard.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GRID_COLUMNS = 4;
// Once the camera collapses away and the grid has the full screen to
// itself, fewer/bigger tiles read better than staying at the compact
// 4-column count sized for sharing space with the camera.
const GRID_COLUMNS_EXPANDED = 3;
const GRID_FETCH_COUNT = 60;

// A quicker, snappier transition than LayoutAnimation's own 300ms default
// preset — used for both the camera collapse/expand and the maximize/
// minimize toggle so neither one feels sluggish.
const QUICK_LAYOUT_ANIMATION = LayoutAnimation.create(
  180,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

// expo-camera's `zoom` prop is 0-1 as "a percentage of the device's max
// zoom" — there's no cross-platform API to read what that max actually is
// in real optical terms, and it varies per device. This is a fixed,
// approximate fraction picked to land near a real 2x on typical phone
// hardware; going below 1x isn't possible through this prop at all (that
// would mean switching to an ultra-wide lens, which isn't controllable
// cross-platform here), so the slider only covers 1x-2x.
const NATIVE_ZOOM_AT_2X = 0.15;
const ZOOM_TRACK_HEIGHT = 150;
const ZOOM_THUMB_HEIGHT = 14;
const ZOOM_TRAVEL = ZOOM_TRACK_HEIGHT - ZOOM_THUMB_HEIGHT;

// Instagram-style "scroll the grid, the camera gets out of the way": past
// this many px of grid scroll the camera preview collapses so Recents can
// use the freed space, and it expands again once scrolled back near the
// top. A comfortably-larger-than-any-real-device max height plus the
// preview's own `aspectRatio` (not an exact measurement) is what lets a
// plain `maxHeight` swap do the collapsing — no onLayout measuring needed.
const CAMERA_COLLAPSE_SCROLL_THRESHOLD = 24;
const CAMERA_MAX_HEIGHT_EXPANDED = 640;

/** One shared empty default, so an omitted `stagedMedia` isn't a new array every render. */
const NO_STAGED_MEDIA: PickedMedia[] = [];

export type MediaGridPickerHandle = {
  confirm: () => Promise<void>;
};

type Props = {
  /** 'post' allows any number of photos/videos; 'clip' is a single video only, and its shutter records instead of snapping a photo. */
  mode: 'post' | 'clip';
  /**
   * Post only — what's already in the post when the author comes back to
   * the grid to change it. Gallery items (those with an `assetId`) start
   * out ticked, in the same order; camera shots, which the grid can't show,
   * are kept as they are. Read once, when the grid opens.
   */
  stagedMedia?: PickedMedia[];
  /** Post only — the most items the post can have in total, staged camera shots included. Ignored in 'clip' mode, which is always capped at one regardless. */
  maxSelectable?: number;
  /**
   * Post mode: the post's complete media list, replacing what the parent had
   * (not an addition to it) — ticked gallery items in tick order, reusing
   * the staged object for any that were already in the post so their photo
   * edits survive, then earlier camera shots, then new ones.
   */
  onConfirm: (media: PickedMedia[]) => void;
  /** How many items confirming now would give the post (post mode) or whether a clip is chosen (clip mode). */
  onSelectionChange: (count: number) => void;
};

/**
 * The live in-app camera + device-photo grid that replaced the old "Take
 * photo or video" / "Choose from gallery" dashed-button pair — this is the
 * real thing (a live `CameraView` preview and an actual `expo-media-
 * library` asset grid), not a restyled shell around the system apps.
 *
 * Selection stays entirely local to this component; the parent only ever
 * learns the final list via `onConfirm`. That's triggered through the
 * imperative `confirm()` handle rather than a button this component draws
 * itself, because the actual "Next" tap target lives in create-post.tsx's
 * shared header (same header/position as every other tab's submit
 * action) — see create-post.tsx's `headerAction` for the wiring.
 */
const MediaGridPicker = forwardRef<MediaGridPickerHandle, Props>(function MediaGridPicker(
  { mode, stagedMedia = NO_STAGED_MEDIA, maxSelectable = Infinity, onConfirm, onSelectionChange },
  ref,
) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [libraryPermission, requestLibraryPermission] = MediaLibrary.usePermissions();

  const [facing, setFacing] = useState<CameraType>('back');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  // Starts from what's already in the post. Before this, the grid always
  // opened with nothing ticked, so going back from the review screen and
  // ticking your photos again added each one to the post a second time
  // (and tripped React's duplicate-key warning in the preview carousel).
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(() =>
    stagedMedia.flatMap((item) => (item.assetId ? [item.assetId] : [])),
  );
  const [capturedItems, setCapturedItems] = useState<PickedMedia[]>([]);
  // Camera shots from an earlier visit to this grid — not gallery assets, so
  // they can't be shown or unticked here; they stay in the post and count
  // toward its limit. (Removable with the × on the review screen.)
  const stagedCaptures = stagedMedia.filter((item) => !item.assetId);
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gridScrolled, setGridScrolled] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  function handleGridScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const shouldCollapse = e.nativeEvent.contentOffset.y > CAMERA_COLLAPSE_SCROLL_THRESHOLD;
    if (shouldCollapse === gridScrolled) return;
    LayoutAnimation.configureNext(QUICK_LAYOUT_ANIMATION);
    setGridScrolled(shouldCollapse);
  }

  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  useEffect(() => {
    if (mode !== 'clip') return;
    if (micPermission && !micPermission.granted && micPermission.canAskAgain) requestMicPermission();
  }, [mode, micPermission, requestMicPermission]);

  useEffect(() => {
    if (libraryPermission && !libraryPermission.granted && libraryPermission.canAskAgain) requestLibraryPermission();
  }, [libraryPermission, requestLibraryPermission]);

  function setFullscreen(next: boolean) {
    LayoutAnimation.configureNext(QUICK_LAYOUT_ANIMATION);
    setIsFullscreen(next);
  }

  // The old <Modal>-based fullscreen got Android back-button handling for
  // free (a Dialog window swallows the back press before it reaches JS).
  // Now that fullscreen is an in-tree overlay, back must be intercepted
  // explicitly so it exits fullscreen instead of bubbling up to the
  // create-post screen's own back handler (which would prompt to discard
  // the whole draft).
  useEffect(() => {
    if (!isFullscreen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setFullscreen(false);
      return true;
    });
    return () => subscription.remove();
  }, [isFullscreen]);

  useEffect(() => {
    if (!libraryPermission?.granted) return;
    MediaLibrary.getAssetsAsync({
      mediaType: mode === 'clip' ? [MediaLibrary.MediaType.video] : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [MediaLibrary.SortBy.creationTime],
      first: GRID_FETCH_COUNT,
    })
      .then((result) => setAssets(result.assets))
      .catch(() => {});
  }, [libraryPermission?.granted, mode]);

  useEffect(() => {
    onSelectionChange(selectedAssetIds.length + stagedCaptures.length + capturedItems.length);
  }, [selectedAssetIds.length, stagedCaptures.length, capturedItems.length, onSelectionChange]);

  useImperativeHandle(
    ref,
    () => ({
      confirm: async () => {
        setBusy(true);
        // A nested function with promise .finally() rather than try/finally,
        // which the React Compiler can't compile; a failure still rejects
        // onward to the caller, as before.
        const resolveSelection = async () => {
          const resolved: PickedMedia[] = [];
          for (const id of selectedAssetIds) {
            // Already in the post: keep that exact item, edits and all. Also
            // covers a staged photo older than the grid's recent window,
            // which wouldn't be in `assets` at all.
            const staged = stagedMedia.find((item) => item.assetId === id);
            if (staged) {
              resolved.push(staged);
              continue;
            }
            const asset = assets.find((a) => a.id === id);
            if (!asset) continue;
            // asset.uri (ph://, content://) isn't reliably readable by the
            // compress/upload pipeline downstream — getAssetInfoAsync's
            // localUri is the guaranteed-local file this app's existing
            // PickedMedia consumers already expect. Android's own asset.uri
            // is already a real file:// path from the same native query
            // (confirmed by the Recents grid itself rendering straight from
            // it), so skip the extra round trip there entirely — it would
            // otherwise throw ("missing ACCESS_MEDIA_LOCATION permission")
            // since getAssetInfoAsync unconditionally tries to read a
            // photo's EXIF GPS data for any image asset, permission this
            // app deliberately doesn't request (isAccessMediaLocationEnabled:
            // false in app.json — this app has no use for photo location data).
            const uri =
              Platform.OS === 'android' ? asset.uri : ((await MediaLibrary.getAssetInfoAsync(asset)).localUri ?? asset.uri);
            // width/height for a video too: expo-media-library's asset size
            // is rotation-corrected (unlike expo-video's track size), which
            // the clip framing needs — see 20260917100000_clip_framing.sql.
            resolved.push(
              asset.mediaType === 'video'
                ? { kind: 'video', uri, assetId: asset.id, width: asset.width, height: asset.height }
                : { kind: 'image', uri, width: asset.width, height: asset.height, assetId: asset.id },
            );
          }
          onConfirm([...resolved, ...stagedCaptures, ...capturedItems]);
        };
        await resolveSelection().finally(() => setBusy(false));
      },
    }),
    [selectedAssetIds, stagedMedia, stagedCaptures, assets, capturedItems, onConfirm],
  );

  function toggleAsset(id: string, isVideo: boolean) {
    if (mode === 'clip') {
      if (!isVideo) return;
      setCapturedItems([]);
      setSelectedAssetIds((prev) => (prev[0] === id ? [] : [id]));
      return;
    }
    setSelectedAssetIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + stagedCaptures.length + capturedItems.length >= maxSelectable) return prev;
      return [...prev, id];
    });
  }

  async function handleShutterPress() {
    if (!cameraRef.current || busy) return;

    if (mode === 'post') {
      if (isCapturingPhoto || selectedAssetIds.length + stagedCaptures.length + capturedItems.length >= maxSelectable) return;
      setIsCapturingPhoto(true);
      // No `finally`: the React Compiler skips a component that has one, and
      // the catch swallows every error, so this is equivalent.
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
        if (photo) setCapturedItems((prev) => [...prev, { kind: 'image', uri: photo.uri, width: photo.width, height: photo.height }]);
      } catch {
        // Camera hardware/permission failure — nothing added, user can retry.
      }
      setIsCapturingPhoto(false);
      return;
    }

    // Clip mode: tap to start recording, tap again to stop. A press-and-
    // hold gesture reads closer to Instagram's own, but Pressable can't
    // cleanly tell "tap" from "hold-then-release" without its own timing
    // hack — a toggle on the same shutter is unambiguous either way.
    if (isRecording) {
      cameraRef.current.stopRecording();
      return;
    }
    setSelectedAssetIds([]);
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      if (video) setCapturedItems([{ kind: 'video', uri: video.uri }]);
    } catch {
      // Recording failure — capturedItems stays empty, user can retry.
    }
    setIsRecording(false);
  }

  const showCamera = cameraPermission?.granted;
  const numColumns = gridScrolled ? GRID_COLUMNS_EXPANDED : GRID_COLUMNS;

  return (
    <View style={styles.wrap}>
      <View
        style={[isFullscreen ? styles.cameraBoxFullscreen : styles.cameraBox, !isFullscreen && { maxHeight: gridScrolled ? 0 : CAMERA_MAX_HEIGHT_EXPANDED }]}
      >
        <CameraSurface
          fullscreen={isFullscreen}
          mode={mode}
          facing={facing}
          showCamera={!!showCamera}
          cameraAccessOff={cameraPermission?.canAskAgain === false}
          isRecording={isRecording}
          isCapturingPhoto={isCapturingPhoto}
          busy={busy}
          cameraRef={cameraRef}
          colors={colors}
          styles={styles}
          onFlip={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          onToggleFullscreen={() => setFullscreen(!isFullscreen)}
          onShutterPress={handleShutterPress}
        />
      </View>

      {/*
        Fullscreen takes the camera out of layout flow (position: absolute),
        so without this the Recents label/grid below would still lay out
        and paint underneath it, and peek through at the rounded corners
        (a rounded box doesn't cover the screen's literal square corners).
        Hiding this section outright while fullscreen — rather than papering
        over the peek-through with an extra backdrop layer — keeps there
        being exactly one thing on screen: the rounded camera itself.
        `pointerEvents="none"` also stops taps landing on now-invisible
        grid tiles.
      */}
      <View style={isFullscreen && styles.hiddenWhileFullscreen} pointerEvents={isFullscreen ? 'none' : 'auto'}>
        <Text style={styles.recentsLabel}>Recents</Text>
      </View>
      <FlatList
        // FlatList doesn't support changing numColumns on the fly — a
        // fresh `key` forces the remount RN itself requires for that.
        // Cheap here (thumbnails are already-decoded/cached expo-image
        // sources being re-laid-out, not the live camera), unlike the
        // CameraView remounts this file goes out of its way to avoid.
        key={numColumns}
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        style={[styles.grid, isFullscreen && styles.hiddenWhileFullscreen]}
        contentContainerStyle={styles.gridContent}
        pointerEvents={isFullscreen ? 'none' : 'auto'}
        onScroll={handleGridScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={
          libraryPermission && !libraryPermission.granted ? (
            <Text style={styles.emptyText}>Allow photo access to see your recent photos and videos here.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const isVideo = item.mediaType === 'video';
          const isSelected = selectedAssetIds.includes(item.id);
          const order = selectedAssetIds.indexOf(item.id);
          return (
            <Pressable style={[styles.gridTile, { flex: 1 / numColumns }]} onPress={() => toggleAsset(item.id, isVideo)} disabled={busy}>
              <Image source={{ uri: item.uri }} style={styles.gridImage} contentFit="cover" />
              {isVideo && (
                <View style={styles.gridPlayBadge}>
                  <Icon name="play" size={11} color="#ffffff" />
                </View>
              )}
              <View style={[styles.gridCheck, isSelected && styles.gridCheckSelected]}>
                {isSelected && mode === 'post' && <Text style={styles.gridCheckText}>{order + 1}</Text>}
                {isSelected && mode === 'clip' && <Icon name="check" size={11} color={colors.bg} />}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
});

export default MediaGridPicker;

type CameraSurfaceProps = {
  fullscreen: boolean;
  mode: 'post' | 'clip';
  facing: CameraType;
  showCamera: boolean;
  cameraAccessOff: boolean;
  isRecording: boolean;
  isCapturingPhoto: boolean;
  busy: boolean;
  cameraRef: RefObject<CameraView | null>;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onFlip: () => void;
  onToggleFullscreen: () => void;
  onShutterPress: () => void;
};

/**
 * Split out from MediaGridPicker so the zoom slider's own drag state lives
 * here, not in the parent — otherwise every frame of a zoom drag would
 * re-render the parent's 60-item asset FlatList along with it.
 */
function CameraSurface({
  fullscreen,
  mode,
  facing,
  showCamera,
  cameraAccessOff,
  isRecording,
  isCapturingPhoto,
  busy,
  cameraRef,
  colors,
  styles,
  onFlip,
  onToggleFullscreen,
  onShutterPress,
}: CameraSurfaceProps) {
  const [zoomFraction, setZoomFraction] = useState(0); // 0 = 1x, 1 = 2x (displayed)

  return (
    <View style={styles.cameraSurfaceInner}>
      {showCamera ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode={mode === 'clip' ? 'video' : 'picture'}
          zoom={zoomFraction * NATIVE_ZOOM_AT_2X}
        />
      ) : (
        <View style={styles.cameraFallback}>
          <Icon name="camera" size={28} color={colors.neutral[500]} />
          <Text style={styles.cameraFallbackText}>
            {cameraAccessOff ? 'Camera access is off — enable it in Settings.' : 'Allow camera access to take a photo.'}
          </Text>
        </View>
      )}

      {showCamera && <ZoomSlider value={zoomFraction} onChange={setZoomFraction} />}

      <Pressable
        style={styles.flipButton}
        onPress={onFlip}
        hitSlop={8}
        disabled={!showCamera}
        accessibilityRole="button"
        accessibilityLabel="Flip camera"
      >
        <Icon name="flipCamera" size={17} color="#ffffff" />
      </Pressable>

      <Pressable
        style={styles.maximizeButton}
        onPress={onToggleFullscreen}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={fullscreen ? 'Exit full screen' : 'View full screen'}
      >
        <Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} color="#ffffff" />
      </Pressable>

      <Pressable
        style={[styles.shutter, isRecording && styles.shutterRecording]}
        onPress={onShutterPress}
        disabled={!showCamera || busy || isCapturingPhoto}
        accessibilityRole="button"
        accessibilityLabel={mode === 'clip' ? (isRecording ? 'Stop recording' : 'Record a clip') : 'Take photo'}
      >
        {isCapturingPhoto ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
        )}
      </Pressable>
    </View>
  );
}

/**
 * The vertical 1x-2x zoom control: a fixed-height track with a draggable
 * block, left-of-center. Grabbing anywhere in the touch column (not just
 * the block itself) jumps the block there and starts the drag — the block
 * alone is too small a target to reliably grab one-handed while framing a
 * shot. Dragging up increases zoom, matching every phone camera app's own
 * convention.
 */
function ZoomSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  // Where the drag started. Written and read only inside the responder
  // handlers below — never during render — which is exactly what a ref is
  // for, and what the React Compiler allows in an event handler.
  //
  // These are the View's own responder props rather than
  // `PanResponder.create().panHandlers`, because that handle has to be
  // built during render: held in a ref, reading `.current` for the spread
  // is a render-time ref read, and moving it into `useState`'s initializer
  // just moves the same closure into render. Either way the compiler skips
  // the component, and it can't tell that the refs the closure captures are
  // only ever touched at gesture time. Raw responder props need no such
  // handle. `value` is read directly at grant time, so the separate
  // value-mirroring ref and its effect are gone too.
  const startValue = useRef(value);
  const startY = useRef(0);

  const thumbOffset = (1 - value) * ZOOM_TRAVEL;

  return (
    <View
      style={zoomStyles.hitArea}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        startValue.current = value;
        startY.current = event.nativeEvent.pageY;
      }}
      onResponderMove={(event) => {
        const dy = event.nativeEvent.pageY - startY.current;
        onChange(Math.min(1, Math.max(0, startValue.current - dy / ZOOM_TRAVEL)));
      }}
    >
      <View style={zoomStyles.track} />
      <View style={[zoomStyles.thumb, { transform: [{ translateY: thumbOffset }] }]} />
      <Text style={[zoomStyles.label, { transform: [{ translateY: thumbOffset - 6 }] }]}>{(1 + value).toFixed(1)}x</Text>
    </View>
  );
}

const zoomStyles = StyleSheet.create({
  hitArea: {
    position: 'absolute',
    left: 14,
    top: '50%',
    marginTop: -(ZOOM_TRACK_HEIGHT / 2),
    height: ZOOM_TRACK_HEIGHT,
    width: 32,
    alignItems: 'center',
  },
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  thumb: {
    width: 28,
    height: ZOOM_THUMB_HEIGHT,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  label: {
    position: 'absolute',
    left: 36,
    minWidth: 30,
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
});

const TILE_GAP = 2;

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
    },
    cameraBox: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      backgroundColor: '#000000',
      marginBottom: Spacing[3],
    },
    cameraBoxFullscreen: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      backgroundColor: '#000000',
      // zIndex alone is enough on this RN version to stack above the
      // Recents label/grid siblings — `elevation` isn't needed for that and
      // was left over from an older RN Android quirk; it also casts an
      // Android shadow that doesn't respect this view's own border radius,
      // which was making the rounded corners look jagged.
      zIndex: 10,
    },
    hiddenWhileFullscreen: {
      opacity: 0,
    },
    cameraSurfaceInner: {
      flex: 1,
    },
    camera: {
      flex: 1,
    },
    cameraFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing[2],
      padding: Spacing[6],
    },
    cameraFallbackText: {
      color: colors.neutral[500],
      textAlign: 'center',
      fontSize: 12.5,
      fontFamily: Fonts.body,
    },
    flipButton: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 34,
      height: 34,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    maximizeButton: {
      position: 'absolute',
      bottom: 12,
      right: 12,
      width: 34,
      height: 34,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutter: {
      position: 'absolute',
      bottom: 14,
      alignSelf: 'center',
      width: 62,
      height: 62,
      borderRadius: Radius.pill,
      borderWidth: 3,
      borderColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterRecording: {
      borderColor: colors.error,
    },
    shutterInner: {
      width: 48,
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: '#ffffff',
    },
    shutterInnerRecording: {
      width: 26,
      height: 26,
      borderRadius: 6,
      backgroundColor: colors.error,
    },
    recentsLabel: {
      ...Typography.label,
      color: colors.neutral[500],
      marginBottom: Spacing[2],
    },
    grid: {
      flex: 1,
    },
    gridContent: {
      gap: TILE_GAP,
    },
    gridTile: {
      // flex (column width) is set inline per-render from the current
      // numColumns — see the renderItem call site.
      aspectRatio: 1,
      margin: TILE_GAP / 2,
      borderRadius: Radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    gridImage: {
      width: '100%',
      height: '100%',
    },
    gridPlayBadge: {
      position: 'absolute',
      right: 4,
      bottom: 4,
    },
    gridCheck: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 20,
      height: 20,
      borderRadius: Radius.pill,
      borderWidth: 1.5,
      borderColor: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    gridCheckSelected: {
      backgroundColor: colors.accent.DEFAULT,
      borderColor: colors.accent.DEFAULT,
    },
    gridCheckText: {
      fontSize: 11,
      fontFamily: Fonts.bodyBold,
      color: colors.bg,
    },
    emptyText: {
      color: colors.neutral[500],
      fontSize: 12.5,
      fontFamily: Fonts.body,
      textAlign: 'center',
      padding: Spacing[6],
    },
  });
