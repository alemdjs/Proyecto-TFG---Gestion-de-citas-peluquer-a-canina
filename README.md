# 🐾 Peluditos · Peluquería canina — Aplicación web de gestión de citas

> **Naturaleza del documento.** Este README es la **bitácora técnica del proyecto**,
> redactada como anexo de un Trabajo de Fin de Grado (TFG). Recoge el **qué** se ha
> construido, el **por qué** de cada decisión tecnológica y de diseño (incluyendo las
> alternativas descartadas), el **cómo** ponerlo en marcha y el estado de verificación.
> Si algo de lo aquí escrito deja de coincidir con el código, **manda el código**.

## Índice

1. [Descripción del sistema](#1-descripción-del-sistema)
2. [Arquitectura general](#2-arquitectura-general)
3. [Decisiones tecnológicas (y alternativas descartadas)](#3-decisiones-tecnológicas-y-alternativas-descartadas)
4. [Decisiones de diseño funcional y de datos](#4-decisiones-de-diseño-funcional-y-de-datos)
5. [Estructura del repositorio](#5-estructura-del-repositorio)
6. [Requisitos previos](#6-requisitos-previos)
7. [Arranque del proyecto (paso a paso)](#7-arranque-del-proyecto-paso-a-paso)
8. [Variables de entorno](#8-variables-de-entorno)
9. [Referencia de la API](#9-referencia-de-la-api)
10. [Cuentas de demostración](#10-cuentas-de-demostración)
11. [Verificación y pruebas realizadas](#11-verificación-y-pruebas-realizadas)
12. [Bitácora del desarrollo](#12-bitácora-del-desarrollo)
13. [Limitaciones conocidas y trabajo futuro](#13-limitaciones-conocidas-y-trabajo-futuro)
14. [Bibliografía y referencias](#14-bibliografía-y-referencias)

---

## 1. Descripción del sistema

Aplicación web para una peluquería canina ficticia («Peluditos») con dos caras:

- **Cara pública (landing + reserva):** presentación del negocio, catálogo de
  servicios con precios y un flujo de reserva online de citas en menos de 2 minutos.
- **Cara de gestión:** paneles según rol para clientes (sus mascotas y citas),
  peluqueros (agenda del día y cambios de estado) y administrador (catálogo y
  todas las citas).

El objetivo académico es demostrar un ciclo completo de ingeniería web moderna:
modelado de datos relacional, API tipada, renderizado en servidor, autenticación
por roles, lógica de disponibilidad sin solapes y despliegue local con Docker.

---

## 2. Arquitectura general

```
┌──────────────┐      HTTPS/JSON (cookie `session`, JWT)      ┌──────────────┐
│  apps/web    │ ───────────────────────────────────────────▶ │  apps/api    │
│  Astro 7 SSR │ ◀─────────────────────────────────────────── │  Elysia +    │
│  puerto 4321 │   catálogo, disponibilidad, citas, mascotas  │  Bun :3000   │
└──────────────┘                                              └──────┬───────┘
                                                                     │ SQL (pg)
                                                              ┌──────▼───────┐
                                                              │  PostgreSQL  │
                                                              │  16, :5433   │
                                                              │  (Docker)    │
                                                              └──────────────┘
```

- **Monorepo con workspaces de Bun** (`apps/*`), inspirado en la organización del
  proyecto de referencia *Levelcast*. Un solo `bun install`, una sola forma de
  arrancar cada pieza (`bun run dev:api`, `bun run dev:web`).
- **Comunicación web → API por `fetch` HTTP+JSON.** El frontend nunca accede a la
  base de datos: toda la lógica de negocio vive en la API. Esto permite razonar
  sobre seguridad y permisos en un único lugar.
- **Sesión mediante cookie `HttpOnly` con JWT firmado (HS256).** El navegador la
  envía automáticamente (`credentials: "include"`); el SSR de Astro la reenvía a
  la API para proteger las páginas privadas.

---

## 3. Decisiones tecnológicas (y alternativas descartadas)

### 3.1. Bun como runtime y gestor de paquetes

**Decisión:** Bun ≥ 1.4.4 para ejecutar la API, el frontend en desarrollo y la
gestión de dependencias del monorepo.

**Por qué:**
- Un único toolchain (runtime + instalador + ejecutor de scripts) frente al
  tándem Node + npm/pnpm. Menos fricción en un TFG y en CI.
- Arranque y recarga (`--watch`) muy rápidos, útiles en desarrollo.
- API nativas aprovechadas: `Bun.password.hash/verify` (hash de contraseñas con
  bcrypt/argon2 sin dependencias extra) y `Bun.S3Client` si en el futuro se
  suben fotos de mascotas.
- Compatibilidad con el ecosistema: el proyecto de referencia ya validó que
  Astro, Elysia, Drizzle y `pg` funcionan bajo Bun.

**Alternativas descartadas:** Node.js + npm (más maduro, pero dos herramientas y
ecosistema más lento de instalar); Deno (menor compatibilidad con paquetes npm
como Astro/Elysia en la fecha del proyecto).

### 3.2. Elysia.js para el backend

**Decisión:** framework Elysia (estilo Express/Fastify, nativo de Bun) con
validación de cuerpos mediante `t.Object` y documentación OpenAPI automática
(`@elysia/openapi`).

**Por qué:**
- Validación en tiempo de ejecución **y** tipos TypeScript inferidos del mismo
  esquema: un solo contrato evita divergencias entre «lo que valido» y «lo que
  tipifico». Muy defendible ante tribunal.
- Rendimiento sobrado para este dominio y sintaxis de rutas por prefijos que
  mantiene el código organizado (`src/routes/*.ts`).
- Coherencia con el proyecto de referencia (Elysia + Drizzle + PostgreSQL),
  lo que permitió reutilizar patrones probados (estructura `db/schema`,
  `db/entities`-equivalente en `routes/`, `drizzle.config.ts`, migraciones).

**Alternativas descartadas:** Express (sin validación ni tipos integrados),
NestJS (potente pero sobredimensionado: decoradores e inyección de dependencias
para un CRUD de citas), Hono (buena opción, pero Elysia ya estaba validada en
el entorno Bun del autor).

### 3.3. Astro 7 (SSR) + Tailwind CSS para el frontend

**Decisión:** Astro con renderizado en servidor (`output: "server"`, adaptador
Node en modo `standalone`) y Tailwind CSS v4 para estilos. Interactividad
puntual con `<script>` del lado cliente (vanilla JS), sin framework SPA.

**Por qué:**
- La landing debe ser **rápida y posicionable (SEO)**: el HTML llega ya
  renderizado con los servicios y precios, sin esperar al JavaScript. Un SPA
  puro (React/Vite) habría dejado la primera pintura vacía.
- Astro permite mezclar en la misma página `fetch` en el servidor (datos
  frescos en cada visita) con pequeñas islas de JS solo donde hace falta
  (selector de huecos, formularios). Para este alcance, añadir Vue/React +
  router + store (como hace Levelcast) era complejidad injustificada.
- Tailwind acelera el maquetado responsive sin salir del HTML y sin sistema de
  diseño propio.

**Alternativas descartadas:** Next.js (gran framework, pero acopla frontend y
backend en un modelo distinto al bipartito API+web que se quería demostrar);
SPA con Vue (el patrón del proyecto de referencia, descartado por exceso de
alcance para una v1: router cliente, Pinia, i18n…).

### 3.4. PostgreSQL 16 en Docker

**Decisión:** base de datos relacional PostgreSQL 16, servida en un contenedor
Docker dedicado (`peluqueria-postgres`, puerto de host **5433**).

**Por qué:**
- El dominio es intrínsecamente relacional (clientes → mascotas → citas →
  servicios/peluqueros) con integridad referencial (claves foráneas, borrados
  en cascada). Un NoSQL documental habría desplazado esa integridad al código.
- Docker garantiza **reproducibilidad**: cualquier miembro del tribunal levanta
  la misma base con `docker compose up -d postgres`, sin instalar nada en el
  sistema. El volumen `postgres-data` persiste los datos entre arranques.
- El puerto 5433 (en lugar del 5432 estándar) se eligió porque el host ya
  ejecuta otro PostgreSQL del proyecto de referencia (`glucose-postgres`
  en 5432). Así **ambos proyectos conviven** sin conflicto.

**Alternativas descartadas:** SQLite (cero despliegue, pero monofichero y sin
concurrencia real: no demuestra un entorno cliente-servidor serio); MySQL
(equivalente razonable, pero PostgreSQL tiene mejor soporte de tipos, `RETURNING`
y ecosistema Drizzle); MongoDB (descarte por el argumento relacional anterior).

### 3.5. Drizzle ORM

**Decisión:** Drizzle ORM (`drizzle-orm` + `drizzle-kit`) como capa de acceso a
datos, con esquema declarado en TypeScript (`src/db/schema/tables.ts`) y
migraciones SQL versionadas en `drizzle/`.

**Por qué:**
- El esquema es **código tipado**: `db.query.*` y `db.insert/update` conocen las
  columnas en compilación, lo que elimina una familia entera de errores.
- Migraciones explícitas y revisables (`db:generate` → SQL → `db:migrate`),
  aptas para incluir en la memoria del TFG como evidencia de evolución del modelo.
- Ligero y cercano a SQL (frente a ORMs con lenguaje propio de consulta),
  coherente con el objetivo didáctico de «ver el SQL que se ejecuta».

**Alternativas descartadas:** Prisma (excelente DX, pero motor binario propio y
migraciones más opacas; además, su soporte Bun era menos rodado); Kysely
(muy buen query-builder, pero sin migraciones ni esquema declarativo integrado);
SQL a mano con `pg` (máximo control, mínimo tipado y más código repetitivo).

### 3.6. Autenticación propia con JWT en cookie (sin proveedor externo)

**Decisión:** registro/login con email + contraseña, hash con `Bun.password`,
sesión JWT HS256 (`jose`) de 7 días en cookie `HttpOnly; SameSite=Lax`, y
guardas por rol en cada endpoint (`requireSession` + comprobación de rol y
propiedad del recurso).

**Por qué:**
- Demuestra los fundamentos (hash, firma, expiración, cookies seguras, control
  de acceso) sin ocultar la lógica tras un servicio externo: valor didáctico
  directo para un TFG.
- Sin dependencias de red en desarrollo (sin IdP, sin emails reales).

**Alternativas descartadas:** Better Auth / Auth.js / Clerk (menos código, pero
cajanegrizan justo lo que el TFG quiere mostrar); sesiones en tabla + Redis
(más correcto a escala, pero añade infraestructura innecesaria en v1; el JWT
firmado es apátrida y suficiente).

### 3.7. Monorepo `apps/api` + `apps/web` (patrón Levelcast, simplificado)

**Decisión:** replicar la **forma** del proyecto de referencia (workspaces Bun,
`apps/api` + `apps/web`, `drizzle.config.ts`, `.env.example`, `docker-compose`
mínimo) pero **no su fondo**: sin Valkey/Redis, sin PWA, sin Stripe, sin
Telegram, sin i18n, sin Storybook, sin Sentry.

**Por qué:** heredar una organización probada reduce riesgo, y recortar todo lo
no esencial para «reservar una cita» mantiene el TFG evaluable en su alcance.
Cada pieza eliminada está documentada en el
[apartado de trabajo futuro](#13-limitaciones-conocidas-y-trabajo-futuro).

---

## 4. Decisiones de diseño funcional y de datos

### 4.1. Roles y matriz de permisos

| Capacidad | Cliente | Peluquero (`groomer`) | Admin |
|---|---|---|---|
| Ver catálogo y disponibilidad | ✅ | ✅ | ✅ |
| Crear/editar sus mascotas | ✅ (solo suyas) | ✅ (cualquiera) | ✅ |
| Reservar cita | ✅ (mascota propia) | ✅ (para clientes) | ✅ |
| Cancelar cita propia pendiente/confirmada | ✅ | ✅ | ✅ |
| Confirmar / finalizar citas | ❌ | ✅ | ✅ |
| Crear / activar-desactivar servicios y peluqueros | ❌ | ❌ | ✅ |

La regla de oro se aplica en servidor: **el cliente solo ve y toca lo suyo**
(`clientId === me.id`, `ownerId === me.id`); el resto de roles operan sobre todo.

### 4.2. Modelo de datos

```
users (id, name, email UNIQUE, password_hash, role, phone)
  1──n pets (id, owner_id → users, name, breed, size S/M/L/XL, weight_kg, notes, birth_date)
  1──n appointments (id, pet_id → pets, service_id → services,
                     staff_id → staff NULL, client_id → users,
                     start_at, end_at, status, notes)
services (id, name, description, price_cents, duration_min, active)
staff    (id, user_id → users NULL, name, active)
staff_services (staff_id → staff, service_id → services — PK compuesta)
  # qué servicios ofrece cada peluquero (modelo Setmore)
```

- **Precios en céntimos (`integer`).** Evita errores de coma flotante en dinero;
  el formateo (`25.00 €`) vive en `apps/web/src/lib/api.ts` (`fmtPrice`).
- **`staff.user_id` anulable:** un peluquero existe como recurso de agenda aunque
  aún no tenga cuenta de usuario (ej. «Marco Estilista» en el seed).
- **`appointments.end_at` calculado en servidor** (`start_at + duración del
  servicio`), nunca confiado al cliente: impide citas de duración manipulada.
- **Borrados en cascada** mascota → citas y usuario → mascotas/citas, para no
  dejar huérfanos al eliminar una ficha.
- **Índice `(staff_id, start_at)`** para que la consulta de solapes escale.

### 4.3. Disponibilidad sin solapes

- Horario de negocio constante: **lunes a sábado, 10:00–19:00** (domingos
  cerrado). Decisión consciente: en v1 es una constante en
  `apps/api/src/utils/slots.ts`, no una tabla, para no sobrediseñar. El paso a
  tabla `business_hours` queda propuesto como trabajo futuro.
- Rejilla de **slots cada 30 min**; cada slot dura lo que el servicio.
- Un slot está libre si ningún `appointment` no-cancelado del peluquero lo
  solapa (`start < existente.end && existente.start < end`).
- Solo los peluqueros que **ofrecen el servicio** (`staff_services`) aparecen en
  la reserva y en la disponibilidad; pedir otro devuelve `400`. La reserva con
  un peluquero no cualificado también se rechaza.
- Si el cliente no elige peluquero, la API **auto-asigna el primero libre
  entre los cualificados**; si ninguno lo está, responde `409`.
- No se permite reservar en el pasado.

### 4.4. Estados de cita

`pending → confirmed → done`, con `cancelled` como salida desde `pending` o
`confirmed`. El cliente solo puede transitar a `cancelled` (y nunca tocar una
cita `done`); peluquero/admin pueden fijar cualquier estado válido. Las citas
canceladas **no bloquean** huecos.

---

## 5. Estructura del repositorio

```
peluqueria-canina/
├── package.json            # workspaces Bun (apps/*), scripts raíz
├── tsconfig.json           # base TS estricta
├── docker-compose.yml      # postgres:16 en 5433 + volumen
├── README.md               # este documento
├── apps/
│   ├── api/
│   │   ├── package.json    # scripts dev/start/db:*
│   │   ├── drizzle.config.ts
│   │   ├── drizzle/        # migraciones SQL versionadas (generadas)
│   │   ├── .env / .env.example
│   │   └── src/
│   │       ├── index.ts    # app Elysia, CORS, OpenAPI, /healthz
│   │       ├── db/
│   │       │   ├── index.ts      # pool pg + drizzle
│   │       │   ├── migrate.ts    # aplica migraciones
│   │       │   ├── seed.ts       # datos iniciales/demo (+ backfill asignaciones)
│   │       │   └── schema/       # users, pets, services, staff, staff_services, appointments
│   │       ├── routes/     # auth, admin (cuentas groomer), catalog (+ asignaciones),
│   │       │               # pets, appointments (availability con nombres)
│   │       └── utils/      # auth (JWT/cookies), slots (horario/solapes)
│   └── web/
│       ├── package.json    # scripts dev/build/preview
│       ├── astro.config.mjs# SSR + adaptador node standalone + Tailwind
│       ├── .env / .env.example  # PUBLIC_API_URL, PUBLIC_BASE_URL
│       └── src/
│           ├── layouts/Base.astro  # cabecera/pie + estado de sesión
│           ├── components/ApptCalendar.astro  # calendario mensual reutilizable
│           ├── lib/api.ts          # helpers fetch + formato
│           ├── styles/global.css
│           └── pages/
│               ├── index.astro      # landing
│               ├── reservar.astro   # servicio → peluquero → calendario → hora → mascota
│               ├── login.astro / register.astro
│               ├── panel.astro      # panel de inicio por rol
│               ├── mis-citas.astro / mis-mascotas.astro   # cliente (con calendario)
│               ├── agenda.astro     # groomer/admin (con calendario)
│               ├── admin.astro      # hub de administración
│               └── admin/
│                   ├── servicios.astro   # CRUD servicios
│                   ├── peluqueros.astro  # fichas + cuentas + asignaciones
│                   └── citas.astro       # filtro y gestión de citas
```

---

## 6. Requisitos previos

| Requisito | Versión usada | Notas |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.4.4 (probado con 1.4.4) | Runtime, instalador y ejecutor |
| [Docker](https://www.docker.com) + Compose | cualquiera reciente | Solo para PostgreSQL |
| Puertos libres | 3000, 4321, 5433 | 5432 ya ocupado por otro proyecto: por eso usamos 5433 |

No se necesita Node.js, ni PostgreSQL instalado en el sistema, ni cuentas en
servicios externos.

---

## 7. Arranque del proyecto (paso a paso)

### 7.1. Primera vez (instalación completa)

```bash
# 1. Levantar la base de datos (una vez; persiste en un volumen Docker)
docker compose up -d postgres

# 2. Instalar dependencias de todo el monorepo (una vez)
bun install

# 3. Generar la migración SQL desde el esquema Drizzle
#    (solo necesario la primera vez o al modificar src/db/schema/)
bun run db:generate

# 4. Aplicar migraciones a la base de datos
bun run db:migrate

# 5. Cargar datos iniciales: servicios, peluqueros y usuarios demo
bun run db:seed
```

### 7.2. Día a día (desarrollo)

En **dos terminales** (o una con `&`):

```bash
# Terminal 1 — API (http://localhost:3000, recarga con --watch)
bun run dev:api

# Terminal 2 — Web (http://localhost:4321)
bun run dev:web
```

Comprobación rápida de que todo vive:

- API: http://localhost:3000/healthz → `{"ok":true,"service":"peluqueria-api"}`
- Web: http://localhost:4321/ → landing con servicios y precios.

### 7.3. Probar el flujo completo (guion de demostración para el tribunal)

1. Abrir http://localhost:4321/ y pulsar **Reservar** en un servicio. El nav muestra
   **Entrar** al estar sin sesión.
2. **Crear cuenta** en `/register` (rol `client` automático).
3. En **Mis mascotas**, dar de alta al perro y **copiar su ID**.
4. En **Reservar**: elegir servicio + fecha, **Buscar huecos**, elegir uno,
   pegar el ID de mascota y **Confirmar reserva**.
5. Ver la cita en **Mi panel** (`/panel`) o en **Mis citas** (se puede cancelar).
   El nav ya muestra **Hola, nombre + Mi panel + Salir**, sin botón Entrar.
6. Entrar como peluquera (`lucia@peluditos.local / groomer123`) en **Agenda**:
   filtrar por fecha, **Confirmar** y **Finalizar**.
7. Entrar como admin (`admin@peluditos.local / admin123`) en **Admin**:
   desactivar/reactivar un servicio y comprobar que desaparece de la landing.

### 7.4. Compilar la web para producción (verificación)

```bash
bun run build:web
# Sirve lo compilado (requiere la API en marcha para el SSR):
cd apps/web && bun ./dist/server/entry.mjs   # escucha en :4321
```

### 7.5. Comandos útiles

```bash
docker compose ps                 # estado del contenedor postgres
docker compose logs postgres      # registros de la base de datos
docker compose down               # detener postgres (los datos persisten)
docker compose down -v             # detener y BORRAR los datos (empezar de cero)
bun run db:migrate                # re-aplicar migraciones pendientes
bun run db:seed                   # re-ejecutar seed (idempotente: no duplica)
```

### 7.6. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `port is already allocated` al subir postgres | Otro contenedor usa 5433 | `docker ps` y detenerlo, o cambiar el puerto en `docker-compose.yml` **y** en `DATABASE_URL` |
| API: `connect ECONNREFUSED :5433` | Postgres aún arrancando o apagado | `docker compose up -d postgres` y esperar ~10 s (healthcheck) |
| Web: «La API no responde» en landing | API apagada | Arrancar `bun run dev:api` |
| `409 Ese hueco ya está ocupado` | Carrera por el mismo slot | Normal: re-buscar huecos y elegir otro |
| Tras `down -v` todo vacío | Volumen borrado | Repetir `db:migrate` + `db:seed` |

---

## 8. Variables de entorno

### `apps/api/.env`

| Variable | Ejemplo | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgres://peluqueria:peluqueria@localhost:5433/peluqueria` | Conexión PostgreSQL |
| `JWT_SECRET` | (secreto largo ≥ 32 caracteres) | Firma de sesiones. **Cambiar en producción** |
| `CORS_DOMAINS` | `http://localhost:4321` | Orígenes permitidos (coma-separados) |
| `ADMIN_EMAILS` | `admin@peluditos.local` | Emails que nacen con rol `admin` al registrarse |

### `apps/web/.env`

| Variable | Ejemplo | Descripción |
|---|---|---|
| `PUBLIC_API_URL` | `http://localhost:3000` | URL base de la API (SSR y cliente) |
| `PUBLIC_BASE_URL` | `http://localhost:4321` | URL pública de la web |

Los `.env` con valores de desarrollo están incluidos para que el tribunal pueda
arrancar sin configuración; los `.env.example` documentan el contrato.

---

## 9. Referencia de la API

Base: `http://localhost:3000`. Todas las respuestas tienen forma
`{ success: true, data }` o `{ success: false, error }`. Autenticación por
cookie `session` (o cabecera `Authorization: Bearer <jwt>`).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/healthz` | — | Salud del servicio |
| POST | `/api/v1/auth/register` | — | Alta (`name, email, password, phone?`) |
| POST | `/api/v1/auth/login` | — | Entrada (fija cookie) |
| POST | `/api/v1/auth/logout` | — | Salida (limpia cookie) |
| GET | `/api/v1/auth/me` | ✅ | Perfil de la sesión |
| GET | `/api/v1/services` | — | Catálogo activo (landing) |
| GET | `/api/v1/services/all` | admin | Catálogo completo |
| POST | `/api/v1/services` | admin | Crear servicio |
| PATCH | `/api/v1/services/:id` | admin | Editar / activar-desactivar |
| DELETE | `/api/v1/services/:id` | admin | Eliminar (409 si tiene citas) |
| GET | `/api/v1/services/:id/staff` | — | Peluqueros que ofrecen el servicio |
| GET | `/api/v1/staff[?serviceId]` | — | Peluqueros activos (filtro por servicio) |
| GET | `/api/v1/staff/all` | admin | Todos + `serviceIds` asignados |
| POST | `/api/v1/staff` | admin | Crear ficha (hereda catálogo activo) |
| PATCH | `/api/v1/staff/:id` | admin | Renombrar / activar-desactivar |
| DELETE | `/api/v1/staff/:id` | admin | Eliminar ficha (409 si tiene citas) |
| GET | `/api/v1/staff/:id/services` | — | Servicios que ofrece |
| PUT | `/api/v1/staff/:id/services` | admin | Reemplazar asignación (`{serviceIds}`) |
| GET | `/api/v1/admin/groomers` | admin | Cuentas de peluquero |
| POST | `/api/v1/admin/groomers` | admin | Crear cuenta de peluquero |
| PATCH | `/api/v1/admin/groomers/:id` | admin | Renombrar / activar-desactivar cuenta |
| GET | `/api/v1/pets` | ✅ | Mascotas (cliente: solo suyas) |
| POST | `/api/v1/pets` | ✅ | Crear mascota |
| DELETE | `/api/v1/pets/:id` | ✅ | Eliminar (propia o admin/groomer) |
| GET | `/api/v1/availability?serviceId&date[&staffId]` | — | Huecos (solo peluqueros cualificados) |
| GET | `/api/v1/appointments[?date][?from][?to][?staffId]` | ✅ | Citas con `petName/serviceName/staffName` |
| POST | `/api/v1/appointments` | ✅ | Reservar (rechaza peluquero no cualificado) |
| PATCH | `/api/v1/appointments/:id/status` | ✅ | Cambiar estado (según matriz §4.1) |

Documentación interactiva autogenerada: http://localhost:3000/openapi.

---

## 10. Cuentas de demostración

Creadas por `bun run db:seed` (contraseñas solo para desarrollo):

| Rol | Email | Contraseña | Uso sugerido |
|---|---|---|---|
| Admin | `admin@peluditos.local` | `admin123` | `/admin`: catálogo y todas las citas |
| Peluquera | `lucia@peluditos.local` | `groomer123` | `/agenda`: confirmar y finalizar |
| Cliente | (registro libre en `/register`) | — | `/panel` → `/mis-mascotas` → `/reservar` (calendario) → `/mis-citas` |

---

## 11. Verificación y pruebas realizadas

Al cierre de esta versión se ejecutó la siguiente batería manual (sin framework
de tests automatizados: decisión consciente por alcance, ver §13):

1. **Infraestructura:** `docker compose up -d postgres` levanta
   `peluqueria-postgres` en `5433` conviviendo con `glucose-postgres:5432`. ✅
2. **Migraciones:** `db:generate` produce 6 tablas (`staff_services` incluida);
   `db:migrate` aplica sin errores; `db:seed` crea admin, groomer, 2 peluqueros,
   5 servicios, 10 asignaciones y 1 mascota demo (idempotente + backfill). ✅
3. **API:** `/healthz` → 200; `GET /services` → 5 servicios; login admin →
   cookie + rol `admin`; `GET /availability?serviceId&date=2026-11-06` →
   17 huecos. ✅
4. **Web:** `bun run build:web` compila sin errores; servida la `dist`,
   la landing responde 200 con precios y enlaces de reserva renderizados
   en servidor. ✅
5. **Reglas de negocio** (revisión de código + pruebas de endpoint): solape
   rechazado con 409, pasado rechazado con 400, domingo rechazado, cita `done`
   intocable por el cliente, `end_at` siempre calculado en servidor. ✅

---

## 12. Bitácora del desarrollo

| Fase | Contenido | Decisiones registradas |
|---|---|---|
| 1. Análisis | Alcance pactado: monorepo `apps/api` + `apps/web`, roles admin/peluquero/cliente, catálogo + mascotas + calendario/disponibilidad, Postgres dedicado en 5433, landing en español. | Se descartó el panel admin completo como requisito cerrado, pero se incluyó un panel mínimo viable por coherencia con los roles. |
| 2. Infraestructura | `docker-compose.yml` (postgres:16-alpine, healthcheck `pg_isready`), `package.json` raíz con workspaces, `.gitignore`, TS base estricta. | Puerto 5433 por coexistencia con el proyecto de referencia; volumen con nombre para persistencia. |
| 3. Backend | Esquema Drizzle (5 tablas), `db:generate` + `db:migrate` + `seed`, auth JWT en cookie, 4 módulos de rutas, utilidades de slots/solapes, OpenAPI. | Auth propia en vez de Better Auth (valor didáctico); `end_at` calculado en servidor; constantes de horario en código (no tabla) para v1. |
| 4. Frontend | Landing SSR, reserva en pasos con disponibilidad real, login/register, paneles por rol y admin por secciones, layout común. | Astro SSR sin SPA (SEO + simplicidad); JS vanilla en lugar de Vue/Pinia; sistema de diseño propio (fase 9) en vez de Tailwind; precios formateados solo en presentación. |
| 5. Verificación | Instalación limpia, migraciones, seed, batería manual API + build + SSR (§11) y redacción de esta bitácora. | Sin tests automatizados en v1 (alcance); la verificación manual queda documentada para poder automatizarla después. |
| 9. Sistema de diseño propio | Se adoptó el diseño del mockup de referencia (`Peluditos, peluquería canina.html`): tipografía Geist, paleta piedra cálida + teal `#0F766E` + ámbar, modo oscuro por `prefers-color-scheme`, y componentes `.card/.btn/.opts/.cal/.badge/.sw/.next`. Se eliminó la dependencia visual de Tailwind (las páginas ya no usan sus clases) y se reescribieron las 12 páginas + `Base.astro` (logo con huella, skip-link, sub-nav por rol, toast global, pie con dirección y horario). Verificado: build OK y E2E de contenido en todas las páginas. |
| 8. Servicios por peluquero + admin por secciones + calendario Setmore | El catálogo era global y el admin una sola página; la reserva pedía fecha a mano e IDs de mascota. Se creó `staff_services` (migración `0001`, seed con reparto + backfill): la disponibilidad y la reserva solo consideran peluqueros cualificados (`400` si se pide otro). CRUD completo de servicios y fichas (con `409` protector si hay citas) y `PUT /staff/:id/services`. El admin se dividió en hub + `/admin/servicios|peluqueros|citas`. Nuevo `ApptCalendar.astro` (puntos por día, banner de próxima cita, evento `cal-select`) usado en `mis-citas` y `agenda`; `reservar` es ahora servicio → peluquero filtrado → calendario de disponibilidad → hora → mascota en desplegable. Verificado con E2E de 12 pasos API + 6 páginas a 200. |
| 7. Sesión en nav + panel | El nav no reflejaba la sesión y no había panel de inicio. Se resolvió la sesión en `Base.astro` vía SSR (`/api/v1/auth/me` con la cookie de la petición): anónimo → Entrar + Reservar; autenticado → saludo + Mi panel + Salir (logout por `POST /auth/logout`). Nueva página `/panel` con resumen por rol y enlaces a cada sección; `/login` redirige allí por defecto. Verificado con E2E de 14 pasos (nav anónimo/logueado, `/panel` por rol y redirección 302 sin sesión). |
| 6. Incidencias | La API registraba `404 NOT_FOUND` con stack y `/mis-citas` fallaba con «is not valid JSON». Causas: (a) en Elysia `context.headers` es un objeto plano, no un `Headers`, así que `headers.get("cookie")` lanzaba `TypeError` y todos los endpoints autenticados devolvían 500; (b) sin ruta `/` ni favicon, cualquier visita a la raíz de la API generaba el 404. | Se pasó a `request.headers` (un `Headers` real) en `requireSession` y `/me`; se añadió ruta `/` informativa, comodín `/*` que responde 404 en JSON y `onError` que solo vuelca stack en 5xx. En la web se centralizó la lectura de respuestas (`readApi`/`apiGet`) para no reventar ante un no-JSON, y se añadió botón «Entrar» en la cabecera + cuentas demo en `/login`. Verificado con E2E de 12 pasos (registro → mascota → reserva → cancelación → permisos). |

---

## 13. Limitaciones conocidas y trabajo futuro

1. **Sin tests automatizados.** Siguiente paso natural: `bun test` en la API
   (solapes, permisos, transiciones de estado) y Playwright en la web,
   siguiendo el patrón del proyecto de referencia.
2. **Horario fijo en código.** Extraer a tabla `business_hours` (e incluso
   festivos) y a panel admin.
3. **Zona horaria.** Las fechas se interpretan en hora local del servidor;
   documentar `Europe/Madrid` y normalizar a UTC es mejora pendiente.
4. **Sin notificaciones.** Recordatorios por email/SMS antes de la cita.
5. **Sin pagos ni fianzas.** Integración de pasarela (redsys/Stripe) para
   reducir ausencias.
6. **Fotos de mascotas.** Subida a S3-compatible (Bun dispone de `S3Client`
   nativo) y galería real en la landing.
7. **Endurecimiento.** `JWT_SECRET` obligatorio en producción, rate-limit de
   login, expiración/rotación de sesiones en tabla, cabeceras de seguridad.
8. **Paginación y búsqueda** en listados cuando el volumen crezca.

---

## 14. Bibliografía y referencias

- Documentación de Drizzle ORM: https://orm.drizzle.team/docs (referencia
  indicada en el enunciado para el modelado y las migraciones).
- Documentación de Astro: https://docs.astro.build
- Documentación de Elysia.js: https://elysiajs.com
- Documentación de Bun: https://bun.sh/docs
- PostgreSQL 16: https://www.postgresql.org/docs/16/
- Proyecto de referencia de arquitectura (monorepo Bun + Elysia + Drizzle +
  Astro): repositorio *Levelcast* (código local del autor, consultado para los
  patrones de `docker-compose`, `drizzle.config.ts` y organización `apps/*`).
