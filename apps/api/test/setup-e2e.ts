/**
 * La suite e2e hace muchos más intentos de login por minuto de los que permite
 * el límite de producción (5/min). Se sube aquí, no en el código de la aplicación.
 * El límite en sí se verifica en el endurecimiento de la Fase 6.
 */
process.env.THROTTLE_LOGIN_LIMIT = '1000';
process.env.THROTTLE_LIMIT = '10000';

/**
 * Credenciales de Meta para las pruebas del webhook.
 *
 * Van AQUÍ y no en el `beforeAll` del test: `ConfigModule.forRoot()` lee y valida
 * el entorno al importar el módulo, que ocurre antes de que corra cualquier hook.
 * Asignarlas después no tendría efecto.
 */
process.env.META_APP_SECRET = 'secreto-de-prueba';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-verificacion';
