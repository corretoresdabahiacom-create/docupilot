import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Renderiza o desafio só quando há chave configurada (sem chave, nada é simulado). */
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const el = ref.current;
    let widgetId: string | undefined;
    const mount = () => {
      if (window.turnstile)
        widgetId = window.turnstile.render(el, { sitekey: SITE_KEY, callback: onToken });
    };
    if (window.turnstile) mount();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = SCRIPT;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', mount);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);

  return SITE_KEY ? <div ref={ref} /> : null;
}
