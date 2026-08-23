-- Fase 7 · RN-13 (base de conocimiento) · RN-09.9 (seguimiento) · RN-04.5 (catálogo)
--
-- Extensiones: contrib estándar, disponible en postgres:16-alpine y en el Postgres
-- embebido del flujo sin Docker. NO se usa pgvector: ver docs/adr-a8-recuperacion-conocimiento.md
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() no es IMMUTABLE porque depende del diccionario que reciba. Fijando el
-- diccionario explícitamente sí lo es, y solo así puede usarse en una columna generada.
CREATE OR REPLACE FUNCTION inmutable_unaccent(text)
RETURNS text AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- CreateEnum
CREATE TYPE "EstadoArticulo" AS ENUM ('borrador', 'publicado', 'archivado');

-- CreateEnum
CREATE TYPE "ResultadoKbConsulta" AS ENUM ('respondida', 'escalada', 'bloqueada_por_tema');

-- CreateEnum
CREATE TYPE "EstadoKbPendiente" AS ENUM ('abierta', 'articulo_creado', 'descartada');

-- CreateEnum
CREATE TYPE "PasoSeguimiento" AS ENUM ('seguimiento_1', 'seguimiento_2', 'cierre');

-- CreateEnum
CREATE TYPE "EstadoSeguimiento" AS ENUM ('programado', 'enviado', 'cancelado', 'diferido', 'descartado');

-- CreateEnum
CREATE TYPE "InteresComercial" AS ENUM ('alto', 'medio', 'nulo');

-- CreateEnum
CREATE TYPE "ResultadoConversacion" AS ENUM ('agendada', 'ofrecida_no_aceptada', 'informativa', 'escalada', 'no_convertida');

-- AlterTable
ALTER TABLE "conversacion" ADD COLUMN     "cta_ofrecido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interes_comercial" "InteresComercial" NOT NULL DEFAULT 'nulo',
ADD COLUMN     "interes_servicio_id" TEXT,
ADD COLUMN     "resultado" "ResultadoConversacion";

-- AlterTable
ALTER TABLE "mensaje" ADD COLUMN     "kb_articulos_usados" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kb_score" INTEGER;

-- AlterTable
ALTER TABLE "paciente" ADD COLUMN     "no_contactar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "servicio" ADD COLUMN     "agendable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "beneficios" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "descripcion_comercial" TEXT,
ADD COLUMN     "enlace_info" TEXT,
ADD COLUMN     "preparacion" TEXT,
ADD COLUMN     "rango_precio" TEXT;

-- CreateTable
CREATE TABLE "kb_articulo" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "contenido_md" TEXT NOT NULL,
    "servicio_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estado" "EstadoArticulo" NOT NULL DEFAULT 'borrador',
    "version" INTEGER NOT NULL DEFAULT 1,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMP(3),
    "archivado_en" TIMESTAMP(3),
    "archivado_por" TEXT,
    "requiere_revision" BOOLEAN NOT NULL DEFAULT false,
    "autor_id" TEXT,
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_fragmento" (
    "id" TEXT NOT NULL,
    "articulo_id" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kb_fragmento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_consulta" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT,
    "mensaje_id" TEXT,
    "pregunta" TEXT NOT NULL,
    "score_top" INTEGER,
    "articulos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resultado" "ResultadoKbConsulta" NOT NULL,
    "tema_bloqueado" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_consulta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_pendiente" (
    "id" TEXT NOT NULL,
    "pregunta_normalizada" TEXT NOT NULL,
    "pregunta_ejemplo" TEXT NOT NULL,
    "ocurrencias" INTEGER NOT NULL DEFAULT 1,
    "ejemplo_conversacion_id" TEXT,
    "estado" "EstadoKbPendiente" NOT NULL DEFAULT 'abierta',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_pendiente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seguimiento" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT NOT NULL,
    "paciente_id" TEXT,
    "telefono" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "paso" "PasoSeguimiento" NOT NULL,
    "estado" "EstadoSeguimiento" NOT NULL DEFAULT 'programado',
    "programado_para" TIMESTAMP(3) NOT NULL,
    "enviado_en" TIMESTAMP(3),
    "motivo_cancelacion" TEXT,
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seguimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Columna generada: se recalcula sola con cada cambio de `texto`, así que es imposible
-- que el índice quede describiendo un contenido viejo.
ALTER TABLE "kb_fragmento"
  ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', inmutable_unaccent(coalesce("texto", '')))) STORED;

-- Capa léxica de la recuperación (RN-13, ADR A8)
CREATE INDEX "kb_fragmento_tsv_idx" ON "kb_fragmento" USING GIN ("tsv");
-- Tolerancia a errores de tipeo y a nombres propios de exámenes
CREATE INDEX "kb_fragmento_texto_trgm_idx" ON "kb_fragmento" USING GIN ("texto" gin_trgm_ops);
-- RN-13.6 · agrupar preguntas sin respuesta por similitud
CREATE INDEX "kb_pendiente_pregunta_trgm_idx" ON "kb_pendiente" USING GIN ("pregunta_normalizada" gin_trgm_ops);

CREATE INDEX "kb_articulo_estado_servicio_id_idx" ON "kb_articulo"("estado", "servicio_id");

-- CreateIndex
CREATE INDEX "kb_articulo_requiere_revision_idx" ON "kb_articulo"("requiere_revision");

-- CreateIndex
CREATE UNIQUE INDEX "kb_fragmento_articulo_id_orden_key" ON "kb_fragmento"("articulo_id", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "kb_consulta_mensaje_id_key" ON "kb_consulta"("mensaje_id");

-- CreateIndex
CREATE INDEX "kb_consulta_resultado_ts_idx" ON "kb_consulta"("resultado", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "kb_pendiente_pregunta_normalizada_key" ON "kb_pendiente"("pregunta_normalizada");

-- CreateIndex
CREATE INDEX "kb_pendiente_estado_ocurrencias_idx" ON "kb_pendiente"("estado", "ocurrencias");

-- CreateIndex
CREATE INDEX "seguimiento_estado_programado_para_idx" ON "seguimiento"("estado", "programado_para");

-- CreateIndex
CREATE INDEX "seguimiento_telefono_servicio_id_creado_en_idx" ON "seguimiento"("telefono", "servicio_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "seguimiento_conversacion_id_paso_key" ON "seguimiento"("conversacion_id", "paso");

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_interes_servicio_id_fkey" FOREIGN KEY ("interes_servicio_id") REFERENCES "servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articulo" ADD CONSTRAINT "kb_articulo_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articulo" ADD CONSTRAINT "kb_articulo_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_fragmento" ADD CONSTRAINT "kb_fragmento_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "kb_articulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_consulta" ADD CONSTRAINT "kb_consulta_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_consulta" ADD CONSTRAINT "kb_consulta_mensaje_id_fkey" FOREIGN KEY ("mensaje_id") REFERENCES "mensaje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seguimiento" ADD CONSTRAINT "seguimiento_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seguimiento" ADD CONSTRAINT "seguimiento_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seguimiento" ADD CONSTRAINT "seguimiento_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seguimiento" ADD CONSTRAINT "seguimiento_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RN-09.9.7.3 · Máximo una secuencia activa por teléfono. Cada secuencia aporta
-- exactamente una fila por paso, así que unicidad sobre (telefono, paso) entre las
-- programadas permite los tres pasos de UNA secuencia y bloquea una segunda.
-- Va como restricción de base de datos y no solo en la aplicación: un bug de reintentos
-- que mande varios mensajes comerciales en una tarde es un riesgo de bloqueo del número.
CREATE UNIQUE INDEX "seguimiento_una_secuencia_activa_por_telefono"
  ON "seguimiento" ("telefono", "paso")
  WHERE "estado" = 'programado';
