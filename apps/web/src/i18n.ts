import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';

export const LOCALES = ['pt', 'en'] as const;
const STORAGE_KEY = 'dp_locale';

function initialLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved;
  } catch {
    /* armazenamento indisponível: segue com o padrão */
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'pt';
}

void i18n.use(initReactI18next).init({
  resources: { pt: { translation: pt }, en: { translation: en }, es: { translation: es } },
  lng: initialLocale(),
  // ES está estruturado, mas vazio: cai para o inglês até ser traduzido.
  fallbackLng: { es: ['en'], default: ['pt'] },
  interpolation: { escapeValue: false },
});

export function setLocale(locale: string): void {
  void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* preferência não persistida */
  }
}

export default i18n;
