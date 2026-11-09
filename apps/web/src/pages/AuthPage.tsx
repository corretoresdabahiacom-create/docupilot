import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Turnstile } from '../components/Turnstile';
import { Banner, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | undefined>();
  const onToken = useCallback((v: string) => setToken(v), []);
  const isRegister = mode === 'register';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password'),
          ...(isRegister ? { displayName: form.get('displayName') } : {}),
          turnstileToken: token,
        },
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'INTERNAL');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">
        {t(isRegister ? 'auth.registerTitle' : 'auth.loginTitle')}
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {isRegister && (
          <Field
            id="displayName"
            name="displayName"
            label={t('auth.displayName')}
            required
            maxLength={100}
            autoComplete="name"
          />
        )}
        <Field
          id="email"
          name="email"
          type="email"
          label={t('auth.email')}
          required
          autoComplete="email"
        />
        <Field
          id="password"
          name="password"
          type="password"
          label={t('auth.password')}
          hint={isRegister ? t('auth.passwordHint') : undefined}
          required
          minLength={isRegister ? 12 : 1}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />
        <Turnstile onToken={onToken} />
        {error && (
          <Banner tone="error">
            {t(`errors.${error}`, { defaultValue: t('errors.INTERNAL') })}
          </Banner>
        )}
        <Button type="submit" disabled={busy}>
          {t(isRegister ? 'auth.submitRegister' : 'auth.submitLogin')}
        </Button>
      </form>
      <p className="mt-4 text-sm text-[var(--muted)]">
        {t(isRegister ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
        <Link className="underline" to={isRegister ? '/login' : '/register'}>
          {t(isRegister ? 'nav.login' : 'nav.register')}
        </Link>
      </p>
    </Card>
  );
}
