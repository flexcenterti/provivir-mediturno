-- CreateTable
CREATE TABLE "consentimiento_whatsapp" (
    "id" TEXT NOT NULL,
    "identificador" TEXT NOT NULL,
    "aceptado" BOOLEAN NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "politica_url" TEXT NOT NULL,
    "paciente_id" TEXT,
    "sede_id" TEXT NOT NULL,

    CONSTRAINT "consentimiento_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consentimiento_whatsapp_identificador_key" ON "consentimiento_whatsapp"("identificador");

-- CreateIndex
CREATE INDEX "consentimiento_whatsapp_paciente_id_idx" ON "consentimiento_whatsapp"("paciente_id");

-- AddForeignKey
ALTER TABLE "consentimiento_whatsapp" ADD CONSTRAINT "consentimiento_whatsapp_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimiento_whatsapp" ADD CONSTRAINT "consentimiento_whatsapp_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
