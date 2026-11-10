import { parseSnippet } from '@docupilot/shared';

/** Trecho da busca. Renderiza como texto (nunca HTML): os destaques viram <mark>. */
export function Snippet({ value }: { value: string }) {
  return (
    <p className="text-sm text-[var(--muted)]">
      {parseSnippet(value).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded bg-[var(--warn-bg)] px-0.5 text-[var(--warn-text)]">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
