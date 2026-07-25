import { useCallback, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NoteEditorScreen } from '../screens/NoteEditorScreen';
import { NoteListScreen } from '../screens/NoteListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

// Plain component state, not a routing library — three screens still don't
// justify expo-router. See PRD §10. Revisit if a 4th screen or deep linking
// ever makes this cumbersome.
//
// The list is the root and is never unmounted; the editor and settings are
// pushed over it, so a single Animated value describes the whole navigation
// state: 0 = list showing, 1 = pushed screen fully covering it.
type Overlay = { name: 'editor'; noteId: string } | { name: 'settings' };

const SLIDE_MS = 300;
/** Decelerating on the way in, accelerating on the way out — the iOS feel. */
const EASE_IN = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_OUT = Easing.bezier(0.4, 0, 1, 1);
/** How far the list slides left as a screen covers it (fraction of width). */
const PARALLAX = 0.25;

function Root() {
  const { scheme, colors } = useTheme();
  const { width } = useWindowDimensions();

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [listRefresh, setListRefresh] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  const push = useCallback(
    (next: Overlay) => {
      setOverlay(next);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: SLIDE_MS,
        easing: EASE_IN,
        useNativeDriver: true,
      }).start();
    },
    [progress],
  );

  const pop = useCallback(() => {
    // Bump the refresh token *before* animating: the list stays mounted under
    // the pushed screen, so without this a renamed or newly created note would
    // snap into place only after the slide finished.
    setListRefresh((n) => n + 1);
    Animated.timing(progress, {
      toValue: 0,
      duration: SLIDE_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setOverlay(null);
    });
  }, [progress]);

  const listShift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width * PARALLAX] });
  const overlayShift = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] });

  return (
    <SafeAreaProvider>
      <View style={[styles.host, { backgroundColor: colors.background }]}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: listShift }] }]}
          pointerEvents={overlay ? 'none' : 'auto'}
        >
          <NoteListScreen
            refreshToken={listRefresh}
            onOpenNote={(noteId) => push({ name: 'editor', noteId })}
            onOpenSettings={() => push({ name: 'settings' })}
          />
        </Animated.View>

        {overlay && (
          <>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrimOpacity }]} />
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.pushed,
                { backgroundColor: colors.background, transform: [{ translateX: overlayShift }] },
              ]}
            >
              {overlay.name === 'editor' ? (
                <NoteEditorScreen noteId={overlay.noteId} onBack={pop} />
              ) : (
                <SettingsScreen onBack={pop} />
              )}
            </Animated.View>
          </>
        )}

        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, overflow: 'hidden' },
  scrim: { backgroundColor: '#000' },
  pushed: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: -4, height: 0 },
    elevation: 16,
  },
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
