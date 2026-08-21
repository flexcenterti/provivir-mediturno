/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clave pública de Cloudflare Turnstile. Se inyecta en el build; sin ella el portal opera sin CAPTCHA. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
