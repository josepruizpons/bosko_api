# Bosko API — Research & Architecture Notes

## Visión general

**Bosko API** es el backend de *Boskofiles* (`boskofiles.com`), una plataforma de automatización del workflow de publicación para productores de música. El flujo principal es:

1. El productor sube un **beat** (audio) y una **thumbnail** (imagen)
2. El sistema los sube a **BeatStars** (marketplace de beats)
3. El sistema publica el track en BeatStars
4. El sistema genera un **video** (audio + imagen estática con ffmpeg / AWS Lambda)
5. El sistema sube el video a **YouTube**, programado para publicarse en una fecha concreta

**Stack:** Express.js v5, TypeScript, PostgreSQL, Prisma ORM, AWS S3 + Lambda, BeatStars GraphQL API, Google/YouTube API.

---

## Estructura de directorios

```
src/
├── index.ts                  # Entry point (HTTPS local / HTTP prod)
├── constants.ts              # Enums y constantes globales
├── db.ts                     # Prisma client singleton
├── utils.ts                  # Utilidades compartidas
├── errors.ts                 # ApiError + helpers de throwing
├── mappers.ts                # DB model → API type
├── google_auth.ts            # Google OAuth2 client factory
├── track_status.ts           # Lógica de estado del track (versión alternativa)
├── aws.ts                    # S3 + Lambda
├── api/
│   └── beatstars-api.ts      # Token BeatStars + queries GraphQL
├── middlewares/
│   └── session.middleware.ts # validate_session
├── routes/
│   ├── app.ts                # Setup Express, CORS, sesión, mounting
│   ├── auth.routes.ts        # POST /auth/login, GET /auth/logout
│   ├── user.routes.ts        # GET /api/user/info
│   ├── tracks.router.ts      # CRUD tracks
│   ├── assets.router.ts      # Upload + stream assets
│   ├── beatstars.routes.ts   # BeatStars upload + publish
│   └── google.routes.ts      # YouTube connect + upload
└── types/
    ├── types.ts              # Tipos de la API pública
    ├── db_types.ts           # Tipos Prisma derivados
    └── bs_types.ts           # Tipos de la API de BeatStars
```

---

## Base de datos — Schema Prisma

### Modelos y relaciones

#### `users`

La entidad raíz. Un usuario humano con email/password.

```prisma
model users {
  id         Int        @id @default(autoincrement())
  email      String     @unique
  password   String     -- bcrypt hash
  is_active  Boolean?   @default(true)
  created_at DateTime?
  settings   Json?      -- Record<string, string>

  asset      asset[]
  oauth      oauth[]
  profiles   profiles[]
  tracks     track[]
}
```

- PK: entero auto-increment
- Todos los datos del usuario (assets, tracks, oauth, profiles) hacen cascade delete

#### `profiles`

Una identidad de publicación dentro de un usuario. Un usuario puede tener varias (diferentes marcas, artistas, etc.).

```prisma
model profiles {
  id      String  @id @db.Char(11)   -- ID aleatorio de 11 chars
  name    String
  id_user Int     -- FK → users (CASCADE delete)
  settings Json?

  asset               asset[]
  profile_connections profile_connections[]
  track               track[]
}
```

- Permite que un usuario gestione múltiples identidades artísticas
- Cada perfil puede tener sus propias conexiones a plataformas
- Tracks y assets pueden estar vinculados a un perfil o solo al usuario

#### `oauth`

Almacena las credenciales OAuth de un usuario para una plataforma (BeatStars o YouTube).

```prisma
model oauth {
  id               Int      @id @default(autoincrement())
  id_user          Int?     -- FK → users
  connection_type  String?  -- 'YOUTUBE' | 'BEATSTARS'
  access_token     String?  -- corta duración, puede ser null
  refresh_token    String   -- larga duración, NOT NULL
  client_secret    String
  client_id        String
  created_at       DateTime?

  profile_connections profile_connections[]
}
```

- Para **YouTube**: el SDK de Google usa el `refresh_token` para renovar automáticamente.
- Para **BeatStars**: se llama al endpoint de token BeatStars en cada request para obtener un `access_token` fresco (no se cachea).
- **No hay endpoint de API para crear filas `oauth`** — se deben insertar manualmente en la BD.

#### `profile_connections`

La tabla pivote que une un perfil con sus credenciales OAuth para una plataforma concreta, más metadatos específicos de ese perfil en esa plataforma.

```prisma
model profile_connections {
  id         String   @id @db.Char(11)
  id_profile String   -- FK → profiles (CASCADE)
  id_oauth   Int      -- FK → oauth (CASCADE)
  platform   String   -- 'YOUTUBE' | 'BEATSTARS'
  meta       Json?    -- metadatos por plataforma
  is_active  Boolean? @default(true)
  created_at DateTime

  @@unique([id_profile, platform])  -- un perfil solo puede tener una conexión por plataforma
}
```

**Campo `meta` según plataforma:**
- `YOUTUBE`: `{ description: string }` → descripción por defecto de los videos
- `BEATSTARS`: `{ tags: string[] }` → tags por defecto para los tracks

#### `asset`

Un fichero (beat o thumbnail) subido al sistema.

```prisma
model asset {
  id           String  @id @db.Char(11)
  name         String  -- nombre original del fichero
  type         String  -- 'BEAT' | 'THUMBNAIL'
  s3_key       String  -- ruta en S3, ej: "beats/1714000000_track.mp3"
  beatstars_id String? -- ID en BeatStars (null hasta que se sube allí)
  mimetype     String?
  id_user      Int?    -- FK → users (opcional)
  id_profile   String? -- FK → profiles (opcional)
  created_at   DateTime
}
```

- Un asset puede pertenecer a un usuario O a un perfil (ambos son opcionales)
- `beatstars_id` empieza como `null` y se setea después de subirlo a BeatStars
- `s3_key` es el path dentro del bucket S3

#### `track`

Un track con su beat, thumbnail, y URLs de publicación.

```prisma
model track {
  id                 String   @id @db.Char(11)
  name               String
  id_user            Int      -- FK → users (CASCADE)
  id_profile         String?  -- FK → profiles (opcional, CASCADE)
  id_beat            String?  -- FK → asset (beat)
  id_thumbnail       String?  -- FK → asset (thumbnail)
  yt_url             String?  -- YouTube URL tras subir
  beatstars_url      String?  -- BeatStars share URL tras publicar
  beatstars_id_track String?  -- ID interno de BeatStars
  publish_at         DateTime -- fecha programada de publicación
  error_message      String?
  created_at         DateTime
}
```

- **El `status` no se almacena** — se computa dinámicamente a partir de los campos presentes
- `publish_at` se usa tanto para la `releaseDate` en BeatStars como para `publishAt` en YouTube

#### Tablas lookup / enum

```prisma
model e_connection_type {
  name String @id  -- 'BEATSTARS' | 'YOUTUBE'
}

model e_asset_type {
  name String @id  -- 'BEAT' | 'THUMBNAIL'
}
```

Enums a nivel de BD para evitar valores inválidos.

---

## Usuarios — Deep Dive

### Autenticación

**Sesión basada en cookies** con `express-session`:

```
Cookie: bosko_session
httpOnly: true
secure: true  (solo HTTPS)
sameSite: 'lax'
maxAge: 7 días
```

**Login (`POST /auth/login`):**
1. Busca usuario por email
2. Compara password con `bcrypt.compare`
3. Setea `req.session.userId = user.id`
4. Devuelve `{ success: true }`

**Middleware `validate_session`:** aplicado a todo `/api/*`. Devuelve `401` si no hay `req.session.userId`.

**`get_current_user(req)`:** resuelve el `userId` de sesión a un objeto `users` completo de la BD.

**Nota:** el session store es **in-memory** (por defecto de express-session). Las sesiones se pierden al reiniciar el servidor.

### Tipo `UserInfo` (lo que devuelve `GET /api/user/info`)

```typescript
type UserInfo = {
  id: number;
  email: string;
  is_active: boolean;
  created_at: Date;
  last_publish_at: Date | null;    // publish_at del track más reciente
  connections: {
    youtube: boolean;              // tiene al menos una fila oauth YOUTUBE
    beatstars: boolean;            // tiene al menos una fila oauth BEATSTARS
  };
  settings: Record<string, string>;
  profiles: Profile[];             // todos los perfiles con sus conexiones
}
```

El campo `connections` es un indicador de alto nivel para que el frontend sepa si el usuario tiene credenciales configuradas para cada plataforma.

---

## Conexiones — Deep Dive

El término "connections" aparece en dos niveles distintos:

### Nivel 1: `oauth` — Credenciales del usuario por plataforma

Es la "fontanería": almacena los tokens OAuth reales que permiten al backend actuar en nombre del usuario en una plataforma.

```
users (1) ──── (many) oauth
               ├── oauth YOUTUBE   (client_id, client_secret, refresh_token)
               └── oauth BEATSTARS (client_id, client_secret, refresh_token)
```

**No hay endpoints de API para crear/gestionar estas filas** — se insertan manualmente en BD.

### Nivel 2: `profile_connections` — Conexión de un perfil a una plataforma

Une un perfil concreto con las credenciales OAuth correspondientes y añade metadatos específicos de ese perfil en esa plataforma.

```
profiles (1) ──── (many) profile_connections
                  ├── connection YOUTUBE
                  │     id_oauth → oauth YOUTUBE
                  │     meta: { description: "..." }
                  └── connection BEATSTARS
                        id_oauth → oauth BEATSTARS
                        meta: { tags: ["afrobeat", ...] }
```

### Relación entre los dos niveles

```
User
 └── oauth (YOUTUBE)     ← credenciales brutas de Google
 └── oauth (BEATSTARS)   ← credenciales brutas de BeatStars
 └── Profile "My Channel"
      └── profile_connection (YOUTUBE)
           ├── id_oauth → oauth(YOUTUBE)
           └── meta: { description: "Get your license: ..." }
      └── profile_connection (BEATSTARS)
           ├── id_oauth → oauth(BEATSTARS)
           └── meta: { tags: ["dancehall", "afrobeat"] }
```

### Estado actual de implementación

**Las rutas de publicación (`/api/bs/*`, `/api/google/*`) NO usan `profile_connections` todavía.** Consultan directamente la tabla `oauth` por `id_user + connection_type`. El esquema de `profile_connections` está completamente modelado y se expone en `GET /api/user/info`, pero aún no se usa para parametrizar el publishing per-perfil.

Esto significa que los tags de BeatStars y la descripción de YouTube están actualmente **hardcodeados** en el código:
- Tags BeatStars: `["dancehall", "afrobeat", "tyla"]` (hardcoded en `beatstars.routes.ts`)
- Géneros: `["AFRO", "AFROBEAT", "AFROPOP"]` (hardcoded)
- BPM: `"220"` (hardcoded)

El diseño intencional es que estos vengan de `profile_connections.meta`.

### Tipo `ProfileConnection`

```typescript
type ProfileConnection = {
  id: string;
  id_profile: string;
  created_at: Date;
} & (
  | { platform: 'YOUTUBE';    meta: { description: string } }
  | { platform: 'BEATSTARS';  meta: { tags: string[] } }
)
```

Unión discriminada por `platform`.

---

## Endpoints de la API

### Públicos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/auth/login` | Login email/password |
| `GET` | `/auth/logout` | Destruye sesión |
| `GET` | `/health` | Health check, testea conexión BD |
| `GET` | `/google/auth_callback` | Callback OAuth2 de Google |

### Protegidos (`/api/*` — requieren sesión)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/check` | Verifica que la sesión está activa (204/401) |
| `GET` | `/api/user/info` | Info completa del usuario + perfiles + conexiones |
| `GET` | `/api/tracks/pending` | Tracks sin `yt_url`, ordenados por `publish_at` |
| `POST` | `/api/tracks` | Crear track |
| `PATCH` | `/api/tracks/:id` | Actualizar track |
| `DELETE` | `/api/tracks/:id` | Borrar track (+ ficheros S3) |
| `POST` | `/api/assets` | Subir asset (multipart, max 500MB) |
| `GET` | `/api/assets/:id` | Stream de asset desde S3 |
| `POST` | `/api/bs/upload` | Subir asset a BeatStars |
| `POST` | `/api/bs/publish` | Publicar track en BeatStars |
| `GET` | `/api/google/connect` | Obtener URL de autorización OAuth2 de Google |
| `POST` | `/api/google/upload-youtube` | Generar video + subir a YouTube |

---

## Status del Track

Calculado dinámicamente (no almacenado), basado en la presencia de campos:

```
yt_url != null                              → 'yt_published'
beatstars_url != null                       → 'bs_published'
beat && thumbnail presentes:
  ambos tienen beatstars_id                 → 'BS_UPLOADED'
  alguno sin beatstars_id                   → 'linked_assets'
sin beat o thumbnail                        → 'draft'
```

**Nota:** existe una segunda implementación en `track_status.ts` con estados más granulares (`PartialAssets`, `Error`, `Created`) pero no está conectada a las rutas actuales.

---

## Integraciones externas

### AWS

- **S3:** almacenamiento de assets (beats, thumbnails, videos temporales)
  - Upload multipart (chunks 5MB, 4 paralelos)
  - URLs presignadas con 30 min de expiración
  - Región: `eu-west-3` (París) por defecto
- **Lambda:** generación de video en producción
  - Función: `bosko-video`
  - Input: `{ audioS3Key, imageS3Key, fileName }`
  - Output: `{ statusCode: 200, body: { key: string } }` — key del video generado en S3

### BeatStars

API GraphQL (`https://core.prod.beatstars.net/studio/graphql`). Flujo de autenticación: `refresh_token` → `access_token` fresco en cada llamada.

**Flujo upload asset:**
1. `createAssetFile` (GraphQL) → obtiene ID y parámetros S3
2. `GET /s3/params` en `uppy-v4.beatstars.net` → presigned POST params
3. `POST` directo a S3 de BeatStars con el fichero
4. Guarda `beatstars_id` en BD

**Flujo publish track:**
1. `addTrack` → obtiene `beatstars_id_track`
2. `attachMainAudioFile` → vincula el audio
3. `attachArtwork` → vincula la thumbnail
4. Espera 5s y hace polling de `GetTrack` para verificar encoding
5. `publishTrack` → obtiene `shareUrl`
6. Actualiza BD con `beatstars_id_track` y `beatstars_url`

### Google / YouTube

- OAuth2 con scope `youtube` completo
- Flujo: popup → `/api/google/connect` → URL auth → callback → guarda `refresh_token`
- El video se genera localmente con `ffmpeg` (dev) o via Lambda (prod)
- Parámetros del video: 1920×1080, letterbox, `libx264`, `aac` 192k, scheduled (`publishAt`)

---

## Generación de IDs

Todos los IDs de entidades (profiles, assets, tracks, profile_connections) usan `generate_id()`:

```typescript
// Alphabet: a-z A-Z 0-9 - _ (64 chars, URL-safe)
// Length: 11 chars → 64^11 ≈ 7.3×10^19 combinaciones
export function generate_id(length = 11): string
```

Los IDs de `users` son enteros auto-increment. Los de `oauth` también.

---

## Gaps y TODOs conocidos

1. **`profile_connections` no conectado al publishing** — tags BeatStars, géneros y BPM están hardcodeados en `beatstars.routes.ts`; deberían venir de `profile_connections.meta`
2. **No hay endpoints de gestión de perfiles** — no hay `POST/PATCH/DELETE /api/profiles`
3. **No hay endpoint de listado de assets** — solo `POST` (crear) y `GET /:id` (stream)
4. **Session store in-memory** — las sesiones se pierden al reiniciar; no escala a múltiples procesos
5. **No hay endpoint para crear/conectar `oauth`** — las credenciales de BeatStars/YouTube se insertan manualmente en BD; `todo.md` menciona automatizarlo con Playwright
6. **Dos sistemas de status de track** en `utils.ts` y `track_status.ts` — deberían unificarse
7. **`get_profile()` en `utils.ts`** — declarada pero sin implementación
8. **`TRACK_STATUS.LOADING`** — definida pero nunca retornada por ninguna función de status
9. **`error_message` en `track`** — campo en schema pero no se escribe en ningún lugar del código actual
10. **BeatStars OAuth** — no hay callback OAuth estándar para BeatStars; se usa directamente `refresh_token` pre-insertado
