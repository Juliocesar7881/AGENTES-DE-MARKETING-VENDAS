import { createContext, useContext } from "react";
import type { Theme } from "../theme";

export const ThemeContext = createContext<Theme | null>(null);
export const AssetsContext = createContext<Record<string, string>>({});

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("ThemeContext missing — render inside <RevenueOSVideo>.");
  return t;
}

/** Resolved URL for an asset id (or null when not available). */
export function useAssetUrl(id: string | null | undefined): string | null {
  const assets = useContext(AssetsContext);
  if (!id) return null;
  return assets[id] ?? null;
}
