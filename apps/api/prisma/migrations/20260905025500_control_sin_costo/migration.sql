-- RN-01.2 · la cita de control no tiene costo para el paciente.
--
-- Los 21 servicios del catálogo real se cargaron sin política explícita y cayeron en
-- el default `costo_pleno`, incluido el control. Hasta ahora no se notaba porque el
-- campo no decidía nada; desde RN-07.6 el mostrador lo lee, y diría que el control
-- se cobra.
--
-- Por `tipo` y no por id, porque la regla habla de la CITA DE CONTROL, no de un
-- servicio concreto. Acotado además por el valor previo: si alguien ya lo puso a mano
-- en otra política, esa decisión no se pisa. Y por eso es idempotente.
--
-- Va en su propia migración, y no dentro del cargador de catálogo, porque ese borra y
-- recrea en bloque todas las agendas de los profesionales: arreglar un campo no
-- justifica llevarse por delante los horarios ajustados desde el backoffice.
UPDATE "servicio"
SET "politica_costo" = 'sin_costo'
WHERE "tipo" = 'control' AND "politica_costo" = 'costo_pleno';
