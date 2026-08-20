-- CreateEnum
CREATE TYPE "TipoCita" AS ENUM ('general', 'control', 'procedimiento', 'examen');

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('admin', 'asistente', 'prestador', 'pantalla');

-- CreateEnum
CREATE TYPE "OrigenPaciente" AS ENUM ('carga', 'mostrador', 'whatsapp', 'autoagendamiento');

-- CreateEnum
CREATE TYPE "OrigenCita" AS ENUM ('mostrador', 'whatsapp', 'autoagendamiento', 'asistente');

-- CreateEnum
CREATE TYPE "ModoAgenda" AS ENUM ('semanal', 'calendario');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('pendiente_llegada', 'confirmada', 'llego', 'en_atencion', 'atendida', 'cancelada', 'no_asistio');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('en_espera', 'llamado', 'en_atencion', 'atendido', 'ausente');

-- CreateEnum
CREATE TYPE "Prioridad" AS ENUM ('alta', 'media', 'baja');

-- CreateEnum
CREATE TYPE "EstadoConversacion" AS ENUM ('ia_activa', 'escalada', 'en_gestion', 'resuelta');

-- CreateEnum
CREATE TYPE "DireccionMensaje" AS ENUM ('entrante', 'saliente');

-- CreateEnum
CREATE TYPE "TipoMensaje" AS ENUM ('texto', 'audio', 'imagen', 'video', 'documento', 'sistema');

-- CreateEnum
CREATE TYPE "PoliticaCosto" AS ENUM ('sin_costo', 'costo_pleno', 'porcentaje');

-- CreateTable
CREATE TABLE "sede" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "wa_numero" TEXT NOT NULL,
    "horario" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente" (
    "id" TEXT NOT NULL,
    "tdoc" TEXT NOT NULL DEFAULT 'CC',
    "documento" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "telefono" TEXT,
    "whatsapp" TEXT,
    "correo" TEXT,
    "fecha_nac" DATE,
    "sexo" TEXT,
    "condiciones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origen" "OrigenPaciente" NOT NULL DEFAULT 'carga',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_servicio" (
    "id" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "servicio_texto" TEXT NOT NULL,

    CONSTRAINT "historial_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "tipo" "TipoCita" NOT NULL,
    "duracion_min" INTEGER NOT NULL,
    "cupos" INTEGER NOT NULL DEFAULT 1,
    "requiere_orden" BOOLEAN NOT NULL DEFAULT false,
    "politica_costo" "PoliticaCosto" NOT NULL DEFAULT 'costo_pleno',
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestador" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "especialidad" TEXT NOT NULL,
    "grupo_balanceo" BOOLEAN NOT NULL DEFAULT false,
    "vinculacion" TEXT NOT NULL DEFAULT 'Interno',
    "consultorio" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "sede_id" TEXT NOT NULL,

    CONSTRAINT "prestador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestador_servicio" (
    "prestador_id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "duracion_min" INTEGER NOT NULL,

    CONSTRAINT "prestador_servicio_pkey" PRIMARY KEY ("prestador_id","servicio_id")
);

-- CreateTable
CREATE TABLE "prestador_config" (
    "prestador_id" TEXT NOT NULL,
    "ventana_control_dias" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "prestador_config_pkey" PRIMARY KEY ("prestador_id")
);

-- CreateTable
CREATE TABLE "agenda" (
    "id" TEXT NOT NULL,
    "prestador_id" TEXT NOT NULL,
    "modo" "ModoAgenda" NOT NULL,
    "dias_semana" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "fecha" DATE,
    "hora_ini" TEXT NOT NULL,
    "hora_fin" TEXT NOT NULL,
    "slot_min" INTEGER NOT NULL,
    "servicio_id" TEXT,
    "consultorio" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "bloqueada" BOOLEAN NOT NULL DEFAULT false,
    "motivo_bloqueo" TEXT,
    "sede_id" TEXT NOT NULL,

    CONSTRAINT "agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cita" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "paciente_id" TEXT NOT NULL,
    "prestador_id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "tipo" "TipoCita" NOT NULL,
    "cita_origen_id" TEXT,
    "fecha" DATE NOT NULL,
    "hora_inicio" INTEGER NOT NULL,
    "duracion_min" INTEGER NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'confirmada',
    "origen" "OrigenCita" NOT NULL,
    "observacion" TEXT,
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turno" (
    "id" TEXT NOT NULL,
    "cita_id" TEXT NOT NULL,
    "llegada_ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'en_espera',
    "prioridad" "Prioridad" NOT NULL DEFAULT 'baja',
    "nota_priorizacion" TEXT,
    "priorizado_por" TEXT,
    "llamado_ts" TIMESTAMP(3),
    "consultorio" TEXT,

    CONSTRAINT "turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversacion" (
    "id" TEXT NOT NULL,
    "paciente_id" TEXT,
    "telefono" TEXT NOT NULL,
    "estado" "EstadoConversacion" NOT NULL DEFAULT 'ia_activa',
    "intencion" TEXT,
    "confianza" INTEGER,
    "escalada" BOOLEAN NOT NULL DEFAULT false,
    "escalada_ts" TIMESTAMP(3),
    "motivo" TEXT,
    "prioridad" "Prioridad" NOT NULL DEFAULT 'baja',
    "tomada_por" TEXT,
    "resuelta_ts" TIMESTAMP(3),
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT NOT NULL,
    "direccion" "DireccionMensaje" NOT NULL,
    "tipo" "TipoMensaje" NOT NULL DEFAULT 'texto',
    "contenido" TEXT,
    "media_path" TEXT,
    "transcripcion" TEXT,
    "wa_message_id" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pantalla" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "servicios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "turnos_visibles" INTEGER NOT NULL DEFAULT 4,
    "sonido" BOOLEAN NOT NULL DEFAULT true,
    "mensaje" TEXT,
    "media" BOOLEAN NOT NULL DEFAULT false,
    "canal_youtube" TEXT,
    "videos_promo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intervalo_institucional_min" INTEGER NOT NULL DEFAULT 10,
    "sede_id" TEXT NOT NULL,

    CONSTRAINT "pantalla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash_password" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "prestador_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acceso" TIMESTAMP(3),
    "sede_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "detalle" TEXT,
    "estado_prev" TEXT,
    "estado_next" TEXT,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descripcion" TEXT,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "paciente_documento_key" ON "paciente"("documento");

-- CreateIndex
CREATE INDEX "paciente_documento_idx" ON "paciente"("documento");

-- CreateIndex
CREATE INDEX "paciente_telefono_idx" ON "paciente"("telefono");

-- CreateIndex
CREATE INDEX "paciente_apellidos_nombres_idx" ON "paciente"("apellidos", "nombres");

-- CreateIndex
CREATE INDEX "historial_servicio_paciente_id_fecha_idx" ON "historial_servicio"("paciente_id", "fecha" DESC);

-- CreateIndex
CREATE INDEX "prestador_grupo_balanceo_activo_idx" ON "prestador"("grupo_balanceo", "activo");

-- CreateIndex
CREATE INDEX "agenda_prestador_id_activa_idx" ON "agenda"("prestador_id", "activa");

-- CreateIndex
CREATE INDEX "agenda_fecha_idx" ON "agenda"("fecha");

-- CreateIndex
CREATE INDEX "cita_fecha_prestador_id_hora_inicio_idx" ON "cita"("fecha", "prestador_id", "hora_inicio");

-- CreateIndex
CREATE INDEX "cita_codigo_idx" ON "cita"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cita_sede_id_fecha_codigo_key" ON "cita"("sede_id", "fecha", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "turno_cita_id_key" ON "turno"("cita_id");

-- CreateIndex
CREATE INDEX "turno_estado_prioridad_llegada_ts_idx" ON "turno"("estado", "prioridad", "llegada_ts");

-- CreateIndex
CREATE INDEX "conversacion_escalada_resuelta_ts_idx" ON "conversacion"("escalada", "resuelta_ts");

-- CreateIndex
CREATE INDEX "conversacion_telefono_idx" ON "conversacion"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "mensaje_wa_message_id_key" ON "mensaje"("wa_message_id");

-- CreateIndex
CREATE INDEX "mensaje_conversacion_id_ts_idx" ON "mensaje"("conversacion_id", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_prestador_id_key" ON "usuario"("prestador_id");

-- CreateIndex
CREATE INDEX "auditoria_ts_idx" ON "auditoria"("ts" DESC);

-- CreateIndex
CREATE INDEX "auditoria_entidad_idx" ON "auditoria"("entidad");

-- AddForeignKey
ALTER TABLE "paciente" ADD CONSTRAINT "paciente_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_servicio" ADD CONSTRAINT "historial_servicio_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestador" ADD CONSTRAINT "prestador_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestador_servicio" ADD CONSTRAINT "prestador_servicio_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestador_servicio" ADD CONSTRAINT "prestador_servicio_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestador_config" ADD CONSTRAINT "prestador_config_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_cita_origen_id_fkey" FOREIGN KEY ("cita_origen_id") REFERENCES "cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "cita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantalla" ADD CONSTRAINT "pantalla_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_prestador_id_fkey" FOREIGN KEY ("prestador_id") REFERENCES "prestador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
