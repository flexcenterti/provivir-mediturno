-- CreateTable
CREATE TABLE "contacto" (
    "id" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'agenda-celular',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacto_telefono_key" ON "contacto"("telefono");

-- CreateIndex
CREATE INDEX "contacto_nombre_idx" ON "contacto"("nombre");
