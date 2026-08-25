# Guía de despliegue · Grupo Provivir (CDC Oriente)

Servidor de referencia: VPS Ubuntu 24 con Docker y Docker Compose.

---

## 1. Preparar el servidor

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"   # cerrar y reabrir sesión
sudo mkdir -p /etc/provivir && sudo chmod 700 /etc/provivir
```

## 2. Secretos

Todos los secretos viven en `/etc/provivir/.env`, con permisos `600`, **fuera del repositorio**.

```bash
sudo tee /etc/provivir/.env > /dev/null <<'ENV'
NODE_ENV=production
PORT=3000

# Base de datos y Redis (contraseñas fuertes, generadas aquí)
POSTGRES_USER=provivir
POSTGRES_PASSWORD=CAMBIAR
POSTGRES_DB=provivir
REDIS_PASSWORD=CAMBIAR

# JWT · generar con: openssl rand -base64 48
JWT_SECRET=CAMBIAR
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=8h

# Dominio público. Temporal: provivir.exagos.co
# Cambiarlo aquí actualiza Caddy, el QR y el enlace que envía el bot por WhatsApp.
DOMINIO=provivir.exagos.co
CORS_ORIGINS=https://provivir.exagos.co
PORTAL_URL=https://provivir.exagos.co/citas

# Rate limiting (valores de producción)
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=120
THROTTLE_LOGIN_LIMIT=5

# Sede y banderas
SEDE_ID=cdc-oriente
KIOSKO_ACTIVO=false

# WhatsApp · Meta Cloud API
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_WEBHOOK_VERIFY_TOKEN=

# IA
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5

# Transcripción de notas de voz (opcional)
STT_URL=
STT_API_KEY=

# CAPTCHA del portal
TURNSTILE_SECRET=

# Respaldos
RESPALDO_CLAVE=CAMBIAR
ENV
sudo chmod 600 /etc/provivir/.env
```

**Sin `RESPALDO_CLAVE` el script de respaldo se niega a correr**: un dump con 400.000
pacientes sin cifrar no debe existir.

## 3. Desplegar

> **Instalación actual: `/home/crivas/provivir`**, con los contenedores construidos desde
> `despliegue/`. El repositorio **no tiene remoto configurado**: el árbol de trabajo ES el origen
> del despliegue, así que no hay `git clone` ni `git pull` que traiga nada. Para una instalación
> nueva en otro servidor, clonar donde corresponda y ajustar las rutas de esta guía y del cron.

```bash
cd /home/crivas/provivir          # instalación nueva: clonar primero y ajustar rutas
npm ci && npm run build          # genera los tres frontends

# Dominio único con rutas: el backoffice va en la raíz, portal y TV en subcarpetas
# que coinciden con el `base` con que se compilaron.
mkdir -p despliegue/web
cp -r apps/backoffice/dist/.  despliegue/web/
cp -r apps/portal/dist        despliegue/web/citas
cp -r apps/tv/dist            despliegue/web/tv

docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env up -d
docker compose -f despliegue/docker-compose.prod.yml exec api npx prisma migrate deploy
```

El seed **no se corre en producción**: crea usuarios con contraseña conocida. Las
credenciales reales se crean aparte, una vez.

## 4. DNS y TLS

Un solo registro `A` apuntando al servidor:

```
provivir.exagos.co    A    <IP del VPS>
```

Caddy emite y renueva el certificado solo. Todo cuelga de ese host:

| Ruta | Aplicación |
|---|---|
| `/` | Backoffice (tras login) |
| `/citas` | Portal público de autoagendamiento |
| `/tv` | Pantallas de sala — **solo desde la red de la sede** |
| `/api` | API |
| `/api/webhooks/whatsapp` | Webhook de Meta |
| `/tiempo-real` | WebSocket de llamados |

Ajusta los rangos IP de `@redInterna` en el `Caddyfile` a la red real de la clínica.

### Cambiar al dominio definitivo

Cuando el cliente defina su dominio, son tres líneas en `/etc/provivir/.env`:

```bash
DOMINIO=agenda.grupoprovivir.com
CORS_ORIGINS=https://agenda.grupoprovivir.com
PORTAL_URL=https://agenda.grupoprovivir.com/citas
```

Luego `docker compose up -d caddy api`. Caddy pide el certificado nuevo solo.

**Antes de cambiar, revisa qué apunta al dominio viejo:** el webhook registrado en el
panel de Meta, los QR impresos en la sede y el iframe embebido en el sitio del cliente.
Si el dominio definitivo permite subdominios, `Caddyfile.subdominios.ejemplo` tiene la
variante con un host por aplicación.

## 5. Webhook de Meta

En el panel de Meta, con el número de **prueba** primero:

- URL: `https://provivir.exagos.co/api/webhooks/whatsapp`
- Token de verificación: el mismo `META_WEBHOOK_VERIFY_TOKEN`
- Campo suscrito: `messages`

La plataforma responde el `hub.challenge` solo si el token coincide.

## 6. Respaldos automáticos

> **Comprobado el 23-08-2026: no había ninguno corriendo.** El cron de esta guía apuntaba a
> `/opt/provivir`, que no existe en el servidor, y el host **no tiene `pg_dump`** —Postgres vive en
> un contenedor—, así que el script no habría funcionado ni con la ruta correcta. El único archivo
> en `apps/api/respaldos/` era un artefacto de desarrollo que además quedó versionado en git.
> Corregido: el script ya puede usar las herramientas del contenedor, y `respaldos/` está ignorado.

El script cifra con AES-256, descarta volcados truncados y rota a 30 días. La clave va en
`/etc/provivir/respaldo.env` (permisos `600`), **nunca** en el repositorio ni en el cron:

```bash
sudo tee /etc/provivir/respaldo.env > /dev/null <<'ENV'
export RESPALDO_CLAVE='<generar con: openssl rand -base64 32>'
export PG_SERVICIO=postgres
export PG_BASE=provivir
export COMPOSE=/home/crivas/provivir/despliegue/docker-compose.prod.yml
export COMPOSE_ENV=/etc/provivir/.env
export DIR_RESPALDOS=/var/backups/provivir
ENV
sudo chmod 600 /etc/provivir/respaldo.env
sudo mkdir -p /var/backups/provivir
```

`DIR_RESPALDOS` apunta **fuera del repositorio**: el valor por defecto escribe dentro, y así fue
como un volcado terminó en git.

**No hace falta la contraseña de Postgres.** Con `PG_BASE`, el volcado corre dentro del contenedor
y se conecta por el socket local, así que la clave no se copia a un segundo archivo donde pueda
quedar desincronizada — que es exactamente el error que dio `password authentication failed` la
primera vez que se intentó.

El script imprime **`Origen:`** antes de volcar. Vale la pena mirarlo: con `PG_SERVICIO` se niega a
heredar el `.env` del repositorio —que es el de desarrollo—, precisamente para no producir un
respaldo con buen aspecto y sin un solo dato de producción.

```bash
sudo crontab -e
# Diario a las 2:00
0 2 * * * . /etc/provivir/respaldo.env && /home/crivas/provivir/apps/api/scripts/respaldo.sh >> /var/log/provivir-respaldo.log 2>&1
```

**Verificar que produce un archivo, sin esperar a mañana:**

```bash
sudo bash -c '. /etc/provivir/respaldo.env && /home/crivas/provivir/apps/api/scripts/respaldo.sh'
sudo ls -lh /var/backups/provivir/
```

Debe imprimir `Respaldo completo:` con un tamaño con cuerpo. Si el script no encuentra `pg_dump`
lo dice y sale con error, en vez de dejar un archivo vacío que parece bueno.

**Probar la restauración antes del lanzamiento** — un respaldo que nunca se restauró no es un
respaldo. Se restaura sobre una base **desechable**, nunca sobre `provivir`:

```bash
cd /home/crivas/provivir
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d postgres -c "CREATE DATABASE prueba_restauracion;"

sudo bash -c '. /etc/provivir/respaldo.env
  PG_BASE=prueba_restauracion \
  /home/crivas/provivir/apps/api/scripts/respaldo.sh --restaurar /var/backups/provivir/provivir-XXXX.dump.gz.enc'

# Comprobar que llegaron datos, no solo que el comando no falló:
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d prueba_restauracion -c "SELECT count(*) FROM paciente;"

sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d postgres -c "DROP DATABASE prueba_restauracion;"
```

Copiar los respaldos **fuera del servidor**: si el VPS muere, los respaldos mueren con él.

## 7. Verificación posterior

```bash
curl -sS https://provivir.exagos.co/api/health/ready       # {"estado":"ok","db":"ok"}
docker compose -f despliegue/docker-compose.prod.yml ps          # todo healthy
docker compose -f despliegue/docker-compose.prod.yml logs -f api
```

Revisa las cabeceras en <https://securityheaders.com> apuntando a `https://provivir.exagos.co`
y a `https://provivir.exagos.co/citas`, que llevan políticas distintas.

## 8. Actualizaciones

**Respalda antes de migrar.** Es un minuto y es la diferencia entre un susto y una pérdida:

```bash
cd /home/crivas/provivir && sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env exec -T postgres \
  pg_dump -U provivir provivir | gzip > ~/respaldo-$(date +%F-%H%M).sql.gz

# El -T no es opcional: sin él, `compose exec` reserva un TTY, la tubería se rompe y el
# respaldo sale VACÍO. El 2026-08-23 dos respaldos seguidos quedaron en 20 bytes por esto.
# Un pg_dump por tubería falla en silencio: gzip crea el archivo igual. Comprobar SIEMPRE.
gunzip -c ~/respaldo-*.sql.gz | tail -4    # debe traer: PostgreSQL database dump complete
ls -lh ~/respaldo-*.sql.gz                 # y pesar bastante más de 20 bytes
```

> **El repositorio ES el origen del despliegue.** Los contenedores se construyen desde
> `/home/crivas/provivir` (compose en `despliegue/`), y no hay remoto configurado: no existe
> `git pull` que traiga nada. **Se despliega lo que esté en el árbol de trabajo en ese momento.**
> Antes de reconstruir, comprobar en qué commit está: `git log --oneline -1`.
>
> Corolario incómodo: un `up -d --build` por cualquier motivo despliega lo que haya en disco,
> aunque no fuera la intención.

```bash
cd /home/crivas/provivir && git log --oneline -1     # ¿es esto lo que se quiere desplegar?
npm ci && npm run build
export C="-f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env"

sudo docker compose $C build api                     # imagen nueva, sin relevar todavía
sudo docker compose $C run --rm --entrypoint sh api -c "cd apps/api && npx prisma migrate status; npx prisma migrate deploy"
sudo docker compose $C up -d api                     # el relevo, ya con las tablas

# El frontend va AL FINAL: Caddy sirve este directorio en vivo, sin reinicio.
cp -r apps/backoffice/dist/. despliegue/web/
cp -r apps/portal/dist/.     despliegue/web/citas/
cp -r apps/tv/dist/.         despliegue/web/tv/
```

**Ese `/.` final y la barra del destino no son adorno.** `cp -r apps/portal/dist despliegue/web/citas`
funciona la primera vez, cuando `citas/` no existe; después crea `citas/dist/` y **el portal sigue
sirviendo el build viejo sin que nada falle a la vista**. Comprobarlo cuesta un comando:
`ls despliegue/web/citas` no debe contener `dist`.

**Y el orden importa.** Migrar desde un contenedor efímero *antes* del relevo evita las dos ventanas
malas: la API nueva contra una base sin sus tablas, y el frontend nuevo contra la API vieja. Las
migraciones solo añaden, así que la API vieja sigue sirviendo encima de la base ya migrada.

`despliegue/web/` está en `.gitignore`: no hay `git checkout` que lo revierta. Antes de copiar,
`tar czf ~/web-pre-<fecha>.tgz -C despliegue web`.

**Los comandos van con `sudo` y con `--env-file`.** Los contenedores corren como `ubuntu` y los
secretos viven en `/etc/provivir/.env`, que es de `root`. Sin `--env-file`, el compose falla con
`required variable POSTGRES_PASSWORD is missing a value` antes de hacer nada.

**El frontend y la API se despliegan por separado.** Caddy sirve `despliegue/web/` como bind-mount
de solo lectura, así que las pantallas no cambian hasta que se copian los `dist`. Reconstruir la
API sola deja el backoffice viejo contra la API nueva.

Las migraciones son versionadas y se aplican con `migrate deploy`, que **nunca** borra datos.

`npm run build` compila los workspaces en orden y `packages/shared` va primero. Importa: la API
resuelve `@provivir/shared` contra su `dist`, no contra el código, así que un `shared` sin
recompilar despliega constantes viejas sin que falle nada visible.

### Despliegue de la fase 7 · base de conocimiento y seguimiento comercial

Lo que trae de distinto respecto de una actualización normal:

**1 · La migración crea dos extensiones de PostgreSQL** (`unaccent` y `pg_trgm`). Son contrib
estándar, ya vienen en la imagen `postgres:16-alpine`, pero `CREATE EXTENSION` exige privilegios:
el `POSTGRES_USER` de la imagen oficial se crea como superusuario, así que funciona. Para
comprobarlo antes:

```bash
docker compose -f despliegue/docker-compose.prod.yml exec postgres \
  psql -U provivir -d provivir -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;"
```

**2 · El seguimiento comercial queda ENCENDIDO.** El parámetro `seguimiento_comercial_activo` vale
`true` por defecto **en el código**, así que basta con desplegar para que empiece a escribirle a
pacientes que preguntaron y no agendaron. Si los textos todavía no están aprobados por el cliente
(decisión D-d), apágalo **antes** de que entre la primera conversación:

```bash
docker compose -f despliegue/docker-compose.prod.yml exec postgres psql -U provivir -d provivir -c \
  "INSERT INTO configuracion (clave, valor, descripcion, actualizado_en)
   VALUES ('seguimiento_comercial_activo', 'false',
           'RN-09.9 · apagado hasta aprobar los textos con el cliente', now())
   ON CONFLICT (clave) DO UPDATE SET valor = 'false', actualizado_en = now();"
```

También se puede desde **Administración → Reglas**, sin desplegar.

**3 · Los permisos nuevos se reconcilian solos al arrancar.** `conocimiento.ver` y
`conocimiento.editar` se agregan al perfil de acceso completo en el arranque de la API. Si algún
perfil a medida necesita verlos, se conceden desde Administración → Perfiles.

**4 · El bot sigue con el bloque de documentación comercial** hasta que alguien importe los
artículos desde **Conocimiento → Importar documentación comercial**. Esa importación es
idempotente y reversible: archivando los artículos, el bloque vuelve solo.

**5 · El umbral `kb_score_min` vale 62 y es una hipótesis**, no un valor medido. Calibrarlo pide
preguntas reales del número de prueba; hasta entonces conviene dejarlo alto (escalar de más es
más barato que responder de más).

### Reversa de esta fase

El código se revierte con `git revert` del merge y un redespliegue. **Las migraciones no se
revierten**: las tablas `kb_*` y `seguimiento` quedan, vacías y sin uso, sin afectar a nada. Para
apagar el comportamiento sin tocar código basta con archivar los artículos y poner
`seguimiento_comercial_activo` en `false`.

## 9. Reversa

Si la API de Meta falla, el número sigue operable a mano: las asistentes atienden desde
la bandeja y el mostrador funciona sin WhatsApp. El agendamiento por portal y backoffice
es independiente del canal.
