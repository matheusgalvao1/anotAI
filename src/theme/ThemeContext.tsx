import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, Palette } from "./palette";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  colors: Palette;
  setPreference: (pref: ThemePreference) => void;
};

const STORAGE_KEY = "anotai.themePreference";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") setPreferenceState(stored);
      setLoaded(true);
    })();
  }, []);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  };

  const scheme: ResolvedScheme = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const colors = scheme === "dark" ? darkPalette : lightPalette;

  const value = useMemo(() => ({ preference, scheme, colors, setPreference }), [preference, scheme, colors]);

  // Skip rendering for the one tick it takes to read the stored preference,
  // rather than flashing the wrong scheme first.
  if (!loaded) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
