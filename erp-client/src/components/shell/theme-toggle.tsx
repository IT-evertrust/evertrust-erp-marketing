'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Dark/light toggle for the topbar. Uses the existing next-themes provider
// (attribute="class" — it flips the `.dark` class on <html>, which globals.css
// keys the emerald palette off). next-themes only resolves the active theme on
// the client, so we gate the icon on `mounted` to avoid a hydration mismatch and
// render a neutral icon until the real value is known.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === 'dark' : true;

  return (
    <Button
      variant="outline"
      size="icon"
      className="size-8"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
