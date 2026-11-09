import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={clsx(
        'min-h-11 rounded-md px-4 text-sm font-medium transition disabled:opacity-50',
        'bg-[var(--primary)] text-[var(--primary-text)] hover:opacity-90',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]',
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
      />
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </div>
  );
}

export function Banner({
  children,
  tone = 'warn',
}: {
  children: ReactNode;
  tone?: 'warn' | 'error';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'rounded-md px-3 py-2 text-sm',
        tone === 'warn'
          ? 'bg-[var(--warn-bg)] text-[var(--warn-text)]'
          : 'border border-[var(--danger)] text-[var(--danger)]',
      )}
    >
      {children}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={clsx(
        'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}
