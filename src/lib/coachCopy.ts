import type { Language } from '../i18n/LanguageContext';

export function getScientistDisplayName(language: Language): string {
  return language === 'bn' ? 'ড. সুস্মিত' : 'Dr. Susmit';
}
