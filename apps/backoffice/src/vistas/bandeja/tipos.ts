/**
 * «interesados» convive con las tres vistas del backend a propósito: para la asistente
 * es un filtro más de la misma lista, aunque por debajo salga de otro endpoint. Lo que
 * no se hace es mandárselo a la API, que solo conoce las otras tres.
 */
export const VISTAS = ['pendientes', 'cerradas', 'todas', 'interesados'] as const;
export type Vista = (typeof VISTAS)[number];
