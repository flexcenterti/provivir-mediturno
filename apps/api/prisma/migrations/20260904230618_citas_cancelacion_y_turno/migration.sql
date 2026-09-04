-- AlterEnum
ALTER TYPE "EstadoTurno" ADD VALUE 'cancelado';

-- AlterTable
ALTER TABLE "cita" ADD COLUMN     "motivo_cancelacion" TEXT;
