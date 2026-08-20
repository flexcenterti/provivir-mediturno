/**
 * La suite e2e hace muchos más intentos de login por minuto de los que permite
 * el límite de producción (5/min). Se sube aquí, no en el código de la aplicación.
 * El límite en sí se verifica en el endurecimiento de la Fase 6.
 */
process.env.THROTTLE_LOGIN_LIMIT = '1000';
process.env.THROTTLE_LIMIT = '10000';
