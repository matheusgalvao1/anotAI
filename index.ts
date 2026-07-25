// Must be the very first import: polyfills crypto.getRandomValues, which
// Hermes doesn't provide natively but `ulid` (src/notes/noteRepository.ts)
// requires. Anything importing ulid transitively must come after this.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
