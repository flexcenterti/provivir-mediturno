-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "perfil_id" TEXT;

-- CreateTable
CREATE TABLE "perfil" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "permisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perfil_nombre_key" ON "perfil"("nombre");

-- CreateIndex
CREATE INDEX "usuario_perfil_id_idx" ON "usuario"("perfil_id");

-- AddForeignKey
ALTER TABLE "perfil" ADD CONSTRAINT "perfil_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;
