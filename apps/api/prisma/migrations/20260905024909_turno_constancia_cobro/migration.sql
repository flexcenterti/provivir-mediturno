-- CreateEnum
CREATE TYPE "CobroMostrador" AS ENUM ('cobrado', 'exento');

-- AlterTable
ALTER TABLE "turno" ADD COLUMN     "cobrado_por" TEXT,
ADD COLUMN     "cobro" "CobroMostrador",
ADD COLUMN     "cobro_nota" TEXT,
ADD COLUMN     "cobro_ts" TIMESTAMP(3);
