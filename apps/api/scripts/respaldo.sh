#!/usr/bin/env bash
#
# Respaldo cifrado de la base de datos · Guía FASE 6, checklist §4.11
#
# Genera un dump comprimido, lo cifra con AES-256 y rota los antiguos.
# La clave NUNCA va en el script: se toma de RESPALDO_CLAVE (variable de entorno
# del servidor, fuera del repo).
#
# Uso:
#   RESPALDO_CLAVE='...' ./scripts/respaldo.sh
#   RESPALDO_CLAVE='...' ./scripts/respaldo.sh --restaurar respaldos/provivir-2026-08-21.dump.gz.enc
#
# Sin `pg_dump` en el host —el caso normal en este servidor, donde Postgres vive
# en un contenedor— se usan las herramientas del propio contenedor:
#
#   PG_SERVICIO=postgres PG_BASE=provivir \
#   COMPOSE=/home/crivas/provivir/despliegue/docker-compose.prod.yml \
#   COMPOSE_ENV=/etc/provivir/.env RESPALDO_CLAVE='...' ./scripts/respaldo.sh
#
# Con PG_BASE no hace falta DATABASE_URL: dentro del contenedor se conecta por el
# socket local y la contraseña no se copia a ningún otro archivo.
#
# `DIR_RESPALDOS` conviene apuntarlo FUERA del repositorio: su valor por defecto
# escribe dentro, y así fue como un volcado terminó versionado en git.
#
# En cron (diario a las 2:00, con la clave en /etc/provivir/respaldo.env):
#   0 2 * * * . /etc/provivir/respaldo.env && /home/crivas/provivir/apps/api/scripts/respaldo.sh >> /var/log/provivir-respaldo.log 2>&1

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_RESPALDOS="${DIR_RESPALDOS:-$RAIZ/respaldos}"
RETENCION_DIAS="${RETENCION_DIAS:-30}"

# Herramientas: en producción vienen del contenedor de Postgres o del paquete
# postgresql-client; PG_BIN permite apuntar a una instalación de usuario.
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_dump 2>/dev/null || echo /usr/bin/pg_dump)")}"
export LD_LIBRARY_PATH="${PG_LIB:-}${PG_LIB:+:}${LD_LIBRARY_PATH:-}"

# Postgres en contenedor: si se indica PG_SERVICIO se usan sus binarios en vez de
# exigir postgresql-client en el host. Además es más correcto, porque la URL de
# producción apunta al host `postgres`, que solo resuelve dentro de la red de Docker.
PG_SERVICIO="${PG_SERVICIO:-}"
COMPOSE="${COMPOSE:-}"
COMPOSE_ENV="${COMPOSE_ENV:-}"

# `exec -T` porque en cron no hay TTY que asignar.
en_postgres() {
  local args=(compose)
  [ -n "$COMPOSE" ] && args+=(-f "$COMPOSE")
  [ -n "$COMPOSE_ENV" ] && args+=(--env-file "$COMPOSE_ENV")
  args+=(exec -T "$PG_SERVICIO")
  docker "${args[@]}" "$@"
}

herramienta() {
  if [ -n "$PG_SERVICIO" ]; then en_postgres "$@"; else "$PG_BIN/$1" "${@:2}"; fi
}

if [ -z "$PG_SERVICIO" ] && ! command -v "$PG_BIN/pg_dump" >/dev/null 2>&1 && [ ! -x "$PG_BIN/pg_dump" ]; then
  echo "No hay pg_dump en $PG_BIN." >&2
  echo "Instala postgresql-client, o usa el contenedor con PG_SERVICIO=postgres" >&2
  echo "(y COMPOSE=/ruta/docker-compose.prod.yml COMPOSE_ENV=/etc/provivir/.env)." >&2
  exit 1
fi

# Con el volcado corriendo DENTRO del contenedor basta con el usuario y la base:
# se conecta por el socket local, que la imagen oficial confía, y así la contraseña
# NO se duplica en un segundo archivo donde puede quedar desincronizada.
PG_BASE="${PG_BASE:-}"
PG_USUARIO="${PG_USUARIO:-provivir}"

if [ -z "$PG_BASE" ]; then
  # El .env del repositorio es el de DESARROLLO. Se acepta como comodidad al correr
  # el script a mano en local, pero NUNCA con PG_SERVICIO: si respaldo.env viniera
  # mal configurado, esto volcaría la base de desarrollo y dejaría un archivo con
  # buen aspecto y sin un solo dato de producción. Un respaldo así es peor que ninguno.
  if [ -z "${DATABASE_URL:-}" ] && [ -z "$PG_SERVICIO" ]; then
    # shellcheck disable=SC1091
    [ -f "$RAIZ/.env" ] && set -a && . "$RAIZ/.env" && set +a
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "Falta PG_BASE o DATABASE_URL." >&2
    [ -n "$PG_SERVICIO" ] && echo "Con PG_SERVICIO no se hereda el .env del repositorio, que es el de desarrollo." >&2
    exit 1
  fi
fi

# Prisma agrega parámetros propios a la URL (`schema`, `connection_limit`) que
# libpq no reconoce y hacen fallar a pg_dump. Se conservan solo los estándar.
limpiar_url() {
  local url="$1" base query conservados=""
  base="${url%%\?*}"
  query="${url#*\?}"
  [ "$query" = "$url" ] && { echo "$base"; return; }

  local IFS='&'
  for par in $query; do
    case "${par%%=*}" in
      sslmode|sslrootcert|sslcert|sslkey|connect_timeout|application_name)
        conservados="${conservados:+$conservados&}$par" ;;
    esac
  done
  [ -n "$conservados" ] && echo "$base?$conservados" || echo "$base"
}

if [ -n "$PG_BASE" ]; then
  CONEXION=(-U "$PG_USUARIO" -d "$PG_BASE")
else
  CONEXION=(--dbname "$(limpiar_url "$DATABASE_URL")")
fi

if [ -z "${RESPALDO_CLAVE:-}" ]; then
  echo "Falta RESPALDO_CLAVE. El respaldo trae datos de 400.000 pacientes: no se genera sin cifrar." >&2
  exit 1
fi

restaurar() {
  local archivo="$1"
  [ -f "$archivo" ] || { echo "No existe: $archivo" >&2; exit 1; }

  echo "Restaurando desde $archivo"
  # -d con --clean: reemplaza el contenido existente. Se restaura sobre la base
  # que indique DATABASE_URL, que en una prueba debe ser una base desechable.
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:RESPALDO_CLAVE -in "$archivo" \
    | gunzip \
    | herramienta pg_restore "${CONEXION[@]}" --clean --if-exists --no-owner --no-privileges

  echo "Restauración completa."
}

if [ "${1:-}" = "--restaurar" ]; then
  restaurar "${2:-}"
  exit 0
fi

mkdir -p "$DIR_RESPALDOS"
FECHA="$(date +%Y-%m-%d-%H%M)"
DESTINO="$DIR_RESPALDOS/provivir-$FECHA.dump.gz.enc"

# Decir SIEMPRE qué base se está volcando: es la comprobación que evita descubrir
# dentro de un año que se respaldaba la base equivocada.
if [ -n "$PG_BASE" ]; then
  ORIGEN="$PG_USUARIO@${PG_SERVICIO:-local}/$PG_BASE"
else
  ORIGEN="$(echo "${CONEXION[1]}" | sed -E 's#//[^@]*@#//#')"
fi

echo "Origen: $ORIGEN"
echo "Generando respaldo $DESTINO"

# Un respaldo a medias es peor que ninguno: si algo falla, no queda el archivo roto.
trap 'rm -f "$DESTINO"' ERR

# El formato custom (-Fc) permite restauración selectiva y es más compacto que SQL plano.
herramienta pg_dump "${CONEXION[@]}" --format=custom --no-owner --no-privileges \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:RESPALDO_CLAVE -out "$DESTINO"

# Un respaldo vacío o truncado es peor que ninguno: se verifica que tenga cuerpo.
TAMANIO=$(stat -c%s "$DESTINO")
if [ "$TAMANIO" -lt 1024 ]; then
  echo "El respaldo generado pesa $TAMANIO bytes: se descarta por sospechoso." >&2
  rm -f "$DESTINO"
  exit 1
fi

echo "Respaldo completo: $(numfmt --to=iec "$TAMANIO" 2>/dev/null || echo "$TAMANIO bytes")"

# Rotación
find "$DIR_RESPALDOS" -name 'provivir-*.dump.gz.enc' -mtime "+$RETENCION_DIAS" -delete
echo "Respaldos conservados: $(find "$DIR_RESPALDOS" -name 'provivir-*.dump.gz.enc' | wc -l) (retención: $RETENCION_DIAS días)"
