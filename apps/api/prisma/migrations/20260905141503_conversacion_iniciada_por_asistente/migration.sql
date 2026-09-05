-- Cuándo una asistente abrió la conversación desde el backoffice, sin que el paciente
-- hubiera escrito. Espejo de `reabierta_ts`: hace que el hilo entre en «pendientes»
-- sin tocar `escalada`, que alimenta las métricas de meses ya reportados.
--
-- Aditiva y sin relleno: `NULL` significa que nadie la abrió a mano, que es lo cierto
-- de todas las conversaciones anteriores a esta migración.
ALTER TABLE "conversacion" ADD COLUMN "iniciada_ts" TIMESTAMP(3);
