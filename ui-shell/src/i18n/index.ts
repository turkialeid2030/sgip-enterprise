/**
 * SGIP i18n Architecture — Bilingual Governance Runtime
 * Arabic (RTL) ↔ English (LTR)
 *
 * Design principles:
 *   1. Arabic-first: default locale is "ar"
 *   2. No hardcoded strings in any component
 *   3. Centralized registry: ar/index.json + en/index.json
 *   4. Dot-notation keys: t("board.title"), t("scenarios.cyber_attack")
 *   5. Fallback chain: ar → en → key itself
 *   6. Locale persisted in localStorage across sessions
 *   7. RTL/LTR applied to document root, not per-component
 *   8. Font stack switches automatically per locale
 *   9. Extensible: add "fr", "ur" etc. by adding a json file only
 *
 * Usage in components:
 *   const { t, dir, locale, setLocale, isRTL } = useTranslation();
 *   <h1>{t("board.title")}</h1>
 *   <div dir={dir} style={{ fontFamily: isRTL ? arabicFont : latinFont }}>
 *
 * Governance alerts (bilingual):
 *   t("alerts.nca_ecc_review")   → Arabic or English based on locale
 */

import arTranslations from "./ar/index.json";
import enTranslations from "./en/index.json";
import { useState, useCallback, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────
export type Locale = "ar" | "en";
export type Direction = "rtl" | "ltr";

interface TranslationRegistry {
  [namespace: string]: { [key: string]: string | TranslationRegistry };
}

// ── Registry ──────────────────────────────────────────────────
const REGISTRY: Record<Locale, TranslationRegistry> = {
  ar: arTranslations as unknown as TranslationRegistry,
  en: enTranslations as unknown as TranslationRegistry,
};

const STORAGE_KEY = "sgip_locale";
const DEFAULT_LOCALE: Locale = "ar";   // Arabic-first by design

// Font stacks per locale
const FONTS: Record<Locale, string> = {
  ar: "'IBM Plex Sans Arabic', 'DM Sans', 'Segoe UI Arabic', sans-serif",
  en: "'DM Sans', 'IBM Plex Sans Arabic', 'Segoe UI', sans-serif",
};

// ── Core API ──────────────────────────────────────────────────

export function getDirection(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale;
    if (stored === "ar" || stored === "en") return stored;
  } catch { /* localStorage unavailable */ }
  const browserLang = typeof navigator !== "undefined" ? navigator.language : "";
  return browserLang.startsWith("ar") ? "ar" : DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
}

export function applyDocumentLocale(locale: Locale): void {
  const dir = getDirection(locale);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", locale);
    document.body.style.fontFamily = FONTS[locale];
  }
}

/**
 * Resolve a dot-notation key against the registry.
 * t("board.title") → looks up registry[locale]["board"]["title"]
 */
export function translate(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>
): string {
  const parts = key.split(".");
  let node: unknown = REGISTRY[locale];

  for (const part of parts) {
    if (node && typeof node === "object") {
      node = (node as Record<string, unknown>)[part];
    } else {
      node = undefined;
      break;
    }
  }

  // Fallback: try English if locale key missing
  if (node === undefined && locale !== "en") {
    return translate(key, "en", params);
  }
  // Final fallback: return the key itself
  if (node === undefined) return key;

  let result = String(node);

  // Interpolate {{paramName}} placeholders
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), String(v));
    }
  }

  return result;
}

// ── React Hook ────────────────────────────────────────────────

export function useTranslation() {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    applyDocumentLocale(next);
  }, []);

  // Apply direction on mount and locale change
  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(key, locale, params),
    [locale]
  );

  return {
    t,
    locale,
    setLocale,
    dir:     getDirection(locale),
    isRTL:   locale === "ar",
    isArabic:locale === "ar",
    font:    FONTS[locale],
    toggle:  () => setLocale(locale === "ar" ? "en" : "ar"),
    opposite:locale === "ar" ? "en" : "ar",
    switchLabel: locale === "ar" ? "English" : "العربية",
  };
}

// ── Governance Alert Helpers ──────────────────────────────────

/** Returns bilingual governance alerts as an array */
export function getGovernanceAlerts(locale: Locale): string[] {
  const keys = ["nca_ecc_review", "pdpl_overdue", "ai_approval_pending"];
  return keys.map(k => translate(`alerts.${k}`, locale));
}

/** Returns bilingual Digital Twin scenario label */
export function getScenarioLabel(scenarioId: string, locale: Locale): string {
  return translate(`scenarios.${scenarioId}`, locale);
}

export default { translate, detectLocale, persistLocale, applyDocumentLocale, getDirection, getGovernanceAlerts, getScenarioLabel };
