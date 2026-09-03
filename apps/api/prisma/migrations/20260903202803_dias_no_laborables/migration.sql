-- CreateEnum
CREATE TYPE "TipoDiaNoLaborable" AS ENUM ('festivo', 'cierre');

-- CreateTable
CREATE TABLE "dia_no_laborable" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "tipo" "TipoDiaNoLaborable" NOT NULL DEFAULT 'festivo',
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dia_no_laborable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dia_no_laborable_fecha_idx" ON "dia_no_laborable"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "dia_no_laborable_sede_id_fecha_key" ON "dia_no_laborable"("sede_id", "fecha");

-- AddForeignKey
ALTER TABLE "dia_no_laborable" ADD CONSTRAINT "dia_no_laborable_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
