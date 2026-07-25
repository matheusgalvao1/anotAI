import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NoteEditorScreen } from '../screens/NoteEditorScreen';
import { NoteListScreen } from '../screens/NoteListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

// Plain component state, not a routing library — three screens still don't
// justify expo-router. See PRD §10. Revisit if a 4th screen or deep linking
// ever makes this cumbersome.
type Screen = { name: 'list' } | { name: 'editor'; noteId: string } | { name: 'settings' };

function Root() {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const { scheme, colors } = useTheme();

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {screen.name === 'list' && (
          <NoteListScreen
            onOpenNote={(noteId) => setScreen({ name: 'editor', noteId })}
            onOpenSettings={() => setScreen({ name: 'settings' })}
          />
        )}
        {screen.name === 'editor' && (
          <NoteEditorScreen noteId={screen.noteId} onBack={() => setScreen({ name: 'list' })} />
        )}
        {screen.name === 'settings' && <SettingsScreen onBack={() => setScreen({ name: 'list' })} />}
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
