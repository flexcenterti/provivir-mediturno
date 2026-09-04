-- AlterEnum
ALTER TYPE "TipoMensaje" ADD VALUE 'plantilla';

-- AlterTable
ALTER TABLE "conversacion" ADD COLUMN     "reabierta_ts" TIMESTAMP(3),
ADD COLUMN     "reaperturas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "mensaje" ADD COLUMN     "autor_id" TEXT;

-- CreateIndex
CREATE INDEX "conversacion_resuelta_ts_idx" ON "conversacion"("resuelta_ts");

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_tomada_por_fkey" FOREIGN KEY ("tomada_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
