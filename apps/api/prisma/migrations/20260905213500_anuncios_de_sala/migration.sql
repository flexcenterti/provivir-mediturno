-- RN-11.7 · Anuncios de la franja inferior del televisor.
--
-- Cuelgan de la sede y no de la pantalla: son los mismos en todos los televisores.
-- `archivo` guarda SOLO el nombre del archivo; la raíz la pone el servidor.
CREATE TABLE "anuncio_sala" (
    "id" TEXT NOT NULL,
    "sede_id" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anuncio_sala_pkey" PRIMARY KEY ("id")
);

-- El televisor los pide ordenados en cada sondeo.
CREATE INDEX "anuncio_sala_sede_id_orden_idx" ON "anuncio_sala"("sede_id", "orden");

ALTER TABLE "anuncio_sala" ADD CONSTRAINT "anuncio_sala_sede_id_fkey"
    FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
