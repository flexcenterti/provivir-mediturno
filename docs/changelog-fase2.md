# Changelog · FASE 2 — Motor de agendamiento

**Estado:** completa. La fase crítica del proyecto.

## Arquitectura
Las reglas puras viven en `citas.reglas.ts` — funciones sin BD ni IO — y el servicio las orquesta
con transacciones. Esto permite property-based testing sobre las reglas y mantiene el principio A3:
**la lógica de negocio no vive en ningún otro módulo**. WhatsApp (Fase 4) y el portal (Fase 5)
consumirán `GET /cupos` y `POST /citas`; no recalculan nada.

## Reglas implementadas
- **RN-01** intercalado, ventana de control por prestador, `citaOrigenId` obligatorio, prefijo `C` en el código.
- **RN-02** balanceo solo en medicina general, conteo comparativo **sin** controles, preferencia respetada.
- **RN-03** compactación por bloques con `hueco_max` configurable; ordena la recomendación sin eliminar cupos
  (RN-03.4: el paciente siempre puede pedir otra hora).
- **RN-04** especialistas por calendario, procedimientos con duración propia, cupos múltiples (Doppler = 40 min).
- Códigos únicos por sede y día, reprogramación (código nuevo si cambia el día) y cancelación, todo auditado.
- Si el cupo se ocupa entre la oferta y la confirmación, la respuesta trae **alternativas** en vez de un error seco.

## Pruebas
- **38 unitarias** sobre las reglas puras, incluidas **5 property-based con fast-check**
  (1.000 corridas en el invariante de RN-01, 500 en generación de cupos y compactación).
- **31 de integración** contra base real, incluida la concurrencia.

## Tres bugs reales que encontraron las pruebas

**1. `agenda.servicioId` se usaba como filtro exclusivo.** Hacía imposible agendar controles:
Osorio atiende `mg` y `ctrl` en la misma franja, que es justo lo que RN-01 exige (el control se
intercala entre consultas). Lo mismo rompía ecografía/Doppler. Quien decide si un prestador atiende
un servicio es `prestador_servicio`; el servicio de la agenda es informativo.

**2. El balanceo elegía un prestador sin verificar disponibilidad.** Con cargas empatadas podía
seleccionar a Ortiz, que atiende 14:00–18:00, para una cita de las 09:00 — y la rechazaba después
de haberla ofrecido. Ahora el balanceo solo compara entre quienes realmente pueden tomar ese horario.

**3. El advisory lock por fecha era demasiado grueso.** Con 20 peticiones simultáneas agotaba el pool
de conexiones y **las 20 fallaban** por timeout de transacción. Ahora se toma un lock por
(fecha, prestador) para la validación y uno de fecha solo en la cola de la transacción, para el
contador del código. La prueba de concurrencia pasó de 5.054 ms fallando a **400 ms con exactamente
1 cita creada y 19 con alternativas**.

## Interpretación que requiere confirmación del cliente

**RN-01.5 · qué cuenta como "control consecutivo".** El documento no lo precisa. Se implementó
**adyacencia real**: cualquier cita que no sea control rompe la cadena, incluidos procedimientos
y exámenes. Racional: el motivo de negocio de la regla es que los controles no facturan, y un suero
de vitamina C entre dos controles sí factura. La lectura alternativa (mirar solo general/control e
ignorar el resto) bloquearía agendas legítimas sin beneficio. **Confirmar con John Mendoza.**

## Decisiones
| # | Decisión | Motivo |
|---|---|---|
| F2-1 | `maxWait: 15 s`, `timeout: 20 s` en las transacciones del motor | Con locks, WhatsApp, portal y mostrador pueden coincidir sobre el mismo médico. |
| F2-2 | `connection_limit=25` en `DATABASE_URL` | El pool por defecto de Prisma se queda corto con peticiones en cola. |
| F2-3 | El código puede repetirse entre días distintos | Es único por sede y día por diseño (constraint en BD); refleja la secuencia diaria del prototipo. |
