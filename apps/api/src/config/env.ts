import { z } from 'zod';

/**
 * Validación de entorno en el arranque. Si falta algo, el proceso NO levanta:
 * preferimos fallar en el arranque que descubrirlo en producción a mitad de una conversación.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Rate limiting. Configurable por ambiente: producción va estricto, las pruebas
  // de carga y las suites e2e necesitan techos distintos.
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  /** Login va mucho más estricto que el resto: es la superficie de fuerza bruta. */
  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),

  // D1 · sede única
  SEDE_ID: z.string().default('cdc-oriente'),
  // D3 · el kiosko se construye pero queda apagado
  KIOSKO_ACTIVO: z.coerce.boolean().default(false),

  // RN-10 · portal público. La URL se usa en el QR y en el enlace que ofrece el bot.
  PORTAL_URL: z.string().url().default('http://localhost:5174'),
  TURNSTILE_SECRET: z.string().optional(),

  // RN-09 · canal WhatsApp. Sin credenciales el canal opera en simulación.
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  // ADR A5 · IA conversacional
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  // RN-09.2 · transcripción de notas de voz
  STT_URL: z.string().optional(),
  STT_API_KEY: z.string().optional(),
  STT_MODELO: z.string().default('whisper-1'),

  // Checklist §4.10 · media fuera del webroot
  DIR_MEDIA: z.string().default('media'),
});

export type Env = z.infer<typeof esquema>;

export function validarEnv(config: Record<string, unknown>): Env {
  const r = esquema.safeParse(config);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detalle}`);
  }
  return r.data;
}

export function origenesCors(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
