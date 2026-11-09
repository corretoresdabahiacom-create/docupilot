export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'dp_theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* indisponível */
  }
  return 'system';
}

export function applyTheme(pref: ThemePref): void {
  const dark =
    pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* preferência não persistida */
  }
}
