"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeCtx {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: "system", resolvedTheme: "dark", setTheme: () => {} });

import { THEME_KEY as KEY } from "@/lib/theme-script";

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  const apply = useCallback((t: Theme) => {
    const dark = t === "dark" || (t === "system" && systemDark());
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    setResolved(dark ? "dark" : "light");
  }, []);

  useEffect(() => {
    let stored: Theme = "dark";
    try {
      stored = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    } catch {
      /* storage unavailable */
    }
    setThemeState(stored);
    apply(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
      if (current === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  const setTheme = useCallback(
    (t: Theme) => {
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* storage unavailable */
      }
      setThemeState(t);
      apply(t);
    },
    [apply],
  );

  return <Ctx.Provider value={{ theme, resolvedTheme: resolved, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
