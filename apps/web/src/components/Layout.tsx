import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LOCALES, setLocale } from '../i18n';
import { api } from '../lib/api';
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme';
import { Banner, Button } from './ui';

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Layout({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    navigate('/login');
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/" className="text-lg font-semibold">
          {t('app.name')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="theme">
            {t('theme.label')}
          </label>
          <select
            id="theme"
            value={theme}
            onChange={(e) => {
              const v = e.target.value as ThemePref;
              setTheme(v);
              applyTheme(v);
            }}
            className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          >
            <option value="system">{t('theme.system')}</option>
            <option value="light">{t('theme.light')}</option>
            <option value="dark">{t('theme.dark')}</option>
          </select>
          <label className="sr-only" htmlFor="locale">
            Idioma / Language
          </label>
          <select
            id="locale"
            value={i18n.language}
            onChange={(e) => setLocale(e.target.value)}
            className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          {signedIn && (
            <Link
              to="/profiles"
              className="inline-flex min-h-11 items-center px-2 text-sm underline"
            >
              {t('nav.profiles')}
            </Link>
          )}
          {signedIn && (
            <Button type="button" onClick={logout}>
              {t('nav.logout')}
            </Button>
          )}
        </div>
      </header>
      {!online && <Banner>{t('status.offline')}</Banner>}
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}
