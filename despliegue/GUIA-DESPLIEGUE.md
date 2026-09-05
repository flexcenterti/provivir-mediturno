# Guía de despliegue · Grupo Provivir (CDC Oriente)

Servidor de referencia: VPS Ubuntu 24 con Docker y Docker Compose.

---

## 1. Preparar el servidor

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo mkdir -p /etc/provivir && sudo chmod 700 /etc/provivir
```

> **Todos los comandos de `docker` de esta guía llevan `sudo`, a propósito.**
>
> Meter al usuario en el grupo `docker` (`usermod -aG docker "$USER"`) evitaría
> escribirlo, pero ese grupo **equivale a root**: quien lo tiene puede montar el
> disco del host dentro de un contenedor privilegiado. En un servidor con la base
> de pacientes no compensa ahorrarse cinco letras.
>
> En la instalación actual el usuario `crivas` **no está** en el grupo `docker`,
> así que sin `sudo` los comandos fallan con `permission denied` sobre
> `/var/run/docker.sock`. No hay Docker rootless: solo el demonio de sistema.

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

sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env up -d --build
sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env exec api npx prisma migrate deploy
```

**Las tres partes del comando son obligatorias y cada una falla distinto:**

| | Si falta | Síntoma |
|---|---|---|
| `sudo` | **no** es por el socket: `crivas` sí está en el grupo `docker`, así que `docker` y `docker exec` funcionan sin él. Lo que exige `sudo` es **leer `/etc/provivir/.env`**, de `root` y con el directorio en `700` | `stat /etc/provivir/.env: permission denied`, o `required variable POSTGRES_PASSWORD is missing a value` si el `--env-file` no se pudo abrir |
| `--env-file` | los secretos son de `root` y viven fuera del repo | `required variable POSTGRES_PASSWORD is missing a value` |
| `--build` | la imagen de la API se compila desde el código fuente | **ninguno**: Compose reutiliza la imagen vieja y el despliegue parece correcto. Con el frontend ya copiado, quedas con pantallas nuevas contra una API vieja |

Y **lánzalo desde `/home/crivas/provivir`**: `-f despliegue/...` es una ruta relativa. Desde
`~` apunta a `/home/crivas/despliegue/`, que no existe. Si prefieres no depender del directorio,
usa la ruta absoluta `-f /home/crivas/provivir/despliegue/docker-compose.prod.yml`.

> Esto es para la **instalación inicial**. Para actualizar una instalación que ya corre, ve al
> §8: el orden ahí es distinto a propósito —migrar antes del relevo y el frontend al final— y
> evita dos ventanas de incoherencia que este comando no cubre.

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
| `/tv` | Pantallas de sala |
| `/api` | API |
| `/api/webhooks/whatsapp` | Webhook de Meta |
| `/tiempo-real` | WebSocket de llamados (handshake y todo el tráfico en vivo) |

**Las pantallas de sala se sirven desde cualquier red.** Es decisión del cliente: los
televisores se instalan y reinstalan sin un técnico de redes cerca, y atarlos a un rango de
IP convertía cada cambio de router en una incidencia. Lo que las protege es que la URL lleva
el UUID de la pantalla, que solo se ve desde el backoffice. Si un enlace se filtra, se retira
la pantalla desde **Pantallas de sala → Configurar → Retirar pantalla** y se crea otra: el
UUID nuevo invalida el viejo.

> Esta guía decía «solo desde la red de la sede» y mandaba ajustar `@redInterna`. Ese matcher
> **no existe** en el `Caddyfile` activo desde hace meses — solo en
> `Caddyfile.subdominios.ejemplo`, que no se usa. Se corrige aquí para que la guía y el
> archivo que corre digan lo mismo.

### El sonido de los televisores

El llamado suena con una campanita y una voz que lee el turno (RN-11.5). Los navegadores
bloquean el audio hasta que alguien toca la pantalla, y un televisor en kiosko no tiene a
nadie tocándola, así que hay dos caminos y conviene usar los dos:

- **Al instalar el stick**, lanza el navegador con
  `--autoplay-policy=no-user-gesture-required`. Con eso el sonido queda armado en cada
  arranque y no hay que tocar nada nunca más.
- **Si no se puede configurar el navegador**, la pantalla muestra una franja amarilla:
  basta pulsar OK en el control una vez, después de cada reinicio. La franja no tapa los
  turnos, y sin tocarla la pantalla funciona igual, muda.

Si el televisor no trae voz en español, la cabecera lo dice («Sin voz en español») y queda
solo la campanita: hay que instalarle el paquete de idioma al aparato.

### Cambiar al dominio definitivo

Cuando el cliente defina su dominio, son tres líneas en `/etc/provivir/.env`:

```bash
DOMINIO=agenda.grupoprovivir.com
CORS_ORIGINS=https://agenda.grupoprovivir.com
PORTAL_URL=https://agenda.grupoprovivir.com/citas
```

Luego, desde `/home/crivas/provivir`:

```bash
sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env up -d caddy api
```

Caddy pide el certificado nuevo solo. Aquí **no** hace falta `--build`: no cambia el código, solo
las variables de entorno.

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
sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env ps                                  # todo healthy
sudo docker compose -f despliegue/docker-compose.prod.yml \
  --env-file /etc/provivir/.env logs -f api
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
> `/home/crivas/provivir` (compose en `despliegue/`). Hay un remoto (`origin`), pero **da igual lo
> que tenga**: no se despliega desde ahí, sino **lo que esté en el árbol de trabajo en ese
> momento** — incluidos los cambios sin commitear. Antes de reconstruir, comprobar en qué commit
> está y que no haya nada suelto: `git log --oneline -1 && git status --short`.
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

**Los comandos van con `sudo` y con `--env-file`.** El usuario del host (`crivas`) no está en el
grupo `docker`, así que sin `sudo` no se llega ni al socket; y los secretos viven en
`/etc/provivir/.env`, que es de `root` con permisos `600`. Sin `--env-file`, el compose falla con
`required variable POSTGRES_PASSWORD is missing a value` antes de hacer nada.

(Dentro de la imagen el proceso corre como `node`, nunca como root: ver el `USER node` del
`Dockerfile.api`.)

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
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d provivir \
  -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;"
```

**2 · El seguimiento comercial queda ENCENDIDO.** El parámetro `seguimiento_comercial_activo` vale
`true` por defecto **en el código**, así que basta con desplegar para que empiece a escribirle a
pacientes que preguntaron y no agendaron. Si los textos todavía no están aprobados por el cliente
(decisión D-d), apágalo **antes** de que entre la primera conversación:

```bash
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d provivir -c \
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

### Despliegue de la pantalla de Base de conocimiento

Posterior a la fase 7. **No trae migraciones**: cero cambios en `schema.prisma`, así que el paso de
`migrate deploy` del §8 es un no-op y se puede dejar tal cual.

**1 · El trabajo de vigencia empieza a ejecutarse de verdad.** `archivarVencidos()` (RN-13.5.5)
estaba implementada desde la fase 7 y **no la llamaba nadie**: no había cron ni trabajo repetible,
así que poner una fecha en «vigente hasta» no hacía nada. Ahora es un repetible de BullMQ que corre
cada día a las **3:15 en la zona de la sede** y archiva todo artículo publicado cuya fecha ya haya
pasado: sale del índice y el bot deja de citarlo.

Es el comportamiento correcto, pero si alguien puso fechas dando por hecho que eran decorativas,
esos artículos desaparecerán del índice en el primer barrido. **Compruébalo antes de desplegar:**

```bash
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d provivir -c \
  "SELECT titulo, vigente_hasta FROM kb_articulo
    WHERE estado = 'publicado' AND vigente_hasta < now();"
```

Si devuelve filas y alguna no debía vencer, límpiale la fecha antes del relevo:

```bash
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec postgres psql -U provivir -d provivir -c \
  "UPDATE kb_articulo SET vigente_hasta = NULL WHERE titulo = '<título exacto>';"
```

Para verificar que el repetible quedó registrado tras el arranque:

```bash
sudo docker compose -f despliegue/docker-compose.prod.yml --env-file /etc/provivir/.env \
  exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:conocimiento:repeat*'
```

**2 · Cuatro parámetros nuevos que se siembran solos.** `kb_temas_prohibidos` y las tres claves de
cadencia del seguimiento (`seguimiento_retraso_1_min`, `_2_min`, `_cierre_min`) las añade
`asegurarBase()` al arrancar la API, de forma aditiva. **Los valores por defecto reproducen
exactamente el comportamiento anterior**: la lista de temas es la misma que estaba en código y la
cadencia sigue siendo 120/300/480 minutos. No hay que tocar la base a mano.

`kb_temas_prohibidos` es la lista de P12 y hasta ahora **no se podía administrar**: no existía como
fila, y el tope de 200 caracteres del endpoint de configuración impedía guardarla de todos modos.
Ahora se edita desde **Base de conocimiento → Temas que escalan siempre**.

**3 · La importación de documentos escribe en disco.** El volumen `uploads` ya existe en el compose
(`uploads:/app/uploads`), así que no hay nada que preparar. Los documentos subidos se trocean por
encabezados y **entran como borrador**: nada llega al bot hasta que alguien los revise y publique.

**4 · El menú cambia de nombre.** «Conocimiento» pasa a «Base de conocimiento». Conviene avisar a
las asistentes antes del despliegue: es el único cambio visible que no añade nada, solo mueve.

## 9. Reversa

Si la API de Meta falla, el número sigue operable a mano: las asistentes atienden desde
la bandeja y el mostrador funciona sin WhatsApp. El agendamiento por portal y backoffice
es independiente del canal.
