'use client';

import { useLayoutEffect } from 'react';
import { getDensity } from '@/lib/preferences';

// Applies the stored display-density preference to <html> before the browser
// paints, so the page never flashes the default spacing first. Density is a
// `data-density` attribute that globals.css reads to retune the Tailwind
// spacing scale (--spacing); "comfortable" is the default and needs no
// attribute, so we only set the dataset when the user chose "compact".
//
// Rendered once inside Providers, this runs on every route. A layout-effect is
// enough here (no inline <head> script) because the density delta is subtle —
// a one-frame shift on the very first load is imperceptible.
export function PreferencesBoot() {
  useLayoutEffect(() => {
    const density = getDensity();
    if (density === 'comfortable') {
      delete document.documentElement.dataset.density;
    } else {
      document.documentElement.dataset.density = density;
    }
  }, []);

  return null;
}
