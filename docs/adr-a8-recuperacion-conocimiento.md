# ADR A8 · Cómo se recupera la base de conocimiento

**Amplía:** `MediTurno_Provivir_Arquitectura_v1.0.md` §10, que llega hasta A7.

**Fecha:** 23 de agosto de 2026 · **Decidido por:** el equipo técnico.

---

## Contexto

RN-13 necesita recuperar fragmentos de artículos a partir de la pregunta de un paciente. La opción
de manual —y la que se propuso primero— es **pgvector** sobre el PostgreSQL que ya existe:
embeddings, índice HNSW, similitud coseno.

No es viable en este proyecto.

| Entorno | PostgreSQL | ¿pgvector? |
|---|---|---|
| dev (`docker-compose.yml`) | `postgres:16-alpine` | No |
| producción (`despliegue/docker-compose.prod.yml`) | `postgres:16-alpine` | No |
| sin Docker (`npm run db:local`) | `embedded-postgres`, binarios PostgreSQL 16 | No, y no hay forma razonable de agregarla |

Cambiar la imagen a `pgvector/pgvector:pg16` resuelve dev y producción pero **rompe el flujo sin
Docker**, que el proyecto sostiene a propósito para máquinas sin demonio disponible. Perder ese
flujo por una función de búsqueda es un mal intercambio.

Verificado en el PostgreSQL embebido: `unaccent`, `pg_trgm` y `btree_gin` están disponibles;
`vector` no.

## Decisión

**Recuperación híbrida sin extensiones nuevas.**

1. **Capa léxica** — `tsvector` con configuración `spanish` más `unaccent`, y `pg_trgm` para
   tolerar errores de tipeo. Todo contrib estándar, presente en los tres entornos. Captura bien lo
   que más se pregunta: nombres propios de exámenes y procedimientos ("Doppler", "TSH"), que son
   justamente los que una búsqueda semántica diluye.

2. **Capa semántica (etapa 2)** — embeddings guardados en una columna normal, cargados en memoria
   al arrancar y al publicar, con el coseno calculado en Node.

3. **Fusión** — Reciprocal Rank Fusion cuando estén las dos capas.

### Por qué la capa semántica no necesita pgvector

Por escala. La base tendrá **cientos de fragmentos, no millones**. Un barrido en memoria de unos
cientos de vectores es de menos de un milisegundo, y el índice cabe holgado en el proceso. pgvector
resuelve un problema de escala que este proyecto no tiene, y a cambio pide una dependencia de
infraestructura en tres entornos.

### Por etapas

Se implementa **primero solo la capa léxica**. Razones:

- Ya es un salto grande frente a inyectar el documento entero en el prompt.
- No agrega dependencia de proveedor de embeddings ni obliga a revisar el DPA otra vez — el de
  OpenAI se firmó para conversación y transcripción (`docs/adr-a5-proveedor-ia.md`).
- El golden set de RN-13 dirá si hace falta la capa semántica. Si la cobertura léxica alcanza, no
  se agrega.

La interfaz de recuperación se diseña para admitir la segunda capa sin cambiar a quien la llama.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| `pgvector/pgvector:pg16` en los tres entornos | Rompe `npm run db:local`; no hay pgvector para `embedded-postgres` |
| Base vectorial dedicada (Pinecone, Qdrant) | Un servicio más que operar, respaldar y pagar, para cientos de documentos. Saca el contenido de las transacciones y los backups que ya existen |
| Seguir inyectando todo el documento en el prompt | Es lo que hay hoy. Paga tokens por conversación, no tiene gobierno ni ciclo de mejora — el problema que RN-13 viene a resolver |
| Solo semántica, sin capa léxica | Los nombres propios de exámenes se diluyen. "Doppler" tiene que recuperar exacto |

## Medido al implementar (23 de agosto)

La capa léxica quedó implementada y probada contra PostgreSQL. Dos hallazgos que
acotan mejor cuándo hará falta la etapa 2:

**El lematizador español unifica más de lo esperado.** `pago`/`pagar`, `sábado`/`sábados`
y `ecografía`/`ecografías` dan el mismo lema, así que las variantes que más aparecen en
las preguntas ya se resuelven solas.

**No unifica la derivación entre categorías gramaticales.** `preparo` da `prepar` y
`preparación` da `preparacion`. Se cubre comparando lexemas por trigramas: esas parejas
quedan entre 0,35 y 0,50 de similitud, mientras que palabras sin relación no pasan de
0,25. El umbral quedó en 0,35.

**Los sinónimos siguen fuera de alcance, y no hay ajuste léxico que los alcance:**

| Par | Similitud | |
|---|---|---|
| `preparo` / `preparación` | 0,46 | se cubre con trigramas |
| `hora` / `horario` | 0,38 | se cubre con trigramas |
| `abren` / `atendemos` | 0,09 | fuera de alcance |
| `cuesta` / `costo` | 0,22 | fuera de alcance |
| `vale` / `precio` | 0,00 | fuera de alcance |

**Disparador concreto de la etapa 2:** que la cola de preguntas sin respuesta (RN-13.6) se
llene de preguntas que **sí** están cubiertas por un artículo pero con otras palabras. Eso
es exactamente lo que resuelven los embeddings y no resuelve ningún ajuste del índice
léxico. Mientras la cola se llene de temas genuinamente ausentes, la respuesta correcta es
escribir el artículo, no cambiar el motor.

Mitigación disponible sin tocar el motor: redactar los artículos con las palabras que usa
el paciente. El ciclo de mejora de RN-13.6 empuja justo en esa dirección.

## Consecuencias

- **Ningún cambio de infraestructura.** No se toca la imagen de PostgreSQL ni el compose.
- Hay que habilitar `unaccent` y `pg_trgm` con una migración (`CREATE EXTENSION IF NOT EXISTS`).
- La búsqueda léxica necesita SQL crudo vía Prisma para `tsvector` y sus índices GIN.
- Si más adelante la base creciera un orden de magnitud, este ADR se revisa. El disparador concreto:
  que el barrido en memoria deje de ser despreciable frente al tiempo de respuesta del LLM.
