"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Locked dark-mode ThemeProvider.
 *
 * - `attribute="class"` — applies the theme via a CSS class on <html>.
 * - `defaultTheme="dark"` — initial theme before hydration.
 * - `forcedTheme="dark"` — permanently locks to dark mode; ignores
 *    system preferences and any user toggle.
 * - `enableSystem={false}` — prevents OS-level light mode from bleeding
 *    through during SSR or hydration.
 * - `disableTransitionOnChange` — prevents a flash of unstyled content
 *    when the DOM hydrates.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
