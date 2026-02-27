# Plan: Migración a sistema de perfiles

## Contexto

Actualmente toda la app opera a nivel de `user`: tracks, assets, credenciales OAuth y publicación se resuelven por `id_user`. El schema de BD ya tiene las tablas `profiles` y `profile_connections`, pero el código las ignora. El objetivo es que **todo lo operacional (tracks, assets, publicación) pase a nivel de perfil**, y el usuario sea simplemente la cuenta de login que agrupa perfiles.

## Modelo mental objetivo

```
Usuario (login, email, password)
 └── Perfil "Artista A"
 │    ├── Conexión BEATSTARS (→ oauth con credenciales BS)
 │    │    └── meta: { tags, genres, bpm }
 │    ├── Conexión YOUTUBE (→ oauth con credenciales YT)
 │    │    └── meta: { description }
 │    ├── Track 1 (beat + thumbnail)
 │    ├── Track 2
 │    └── Assets (beats, thumbnails)
 └── Perfil "Artista B"
      ├── Conexión BEATSTARS (→ otro oauth o el mismo)
      ├── Conexión YOUTUBE (→ otro oauth o el mismo)
      ├── Track 3
      └── Assets
```

Un usuario puede tener N perfiles. Cada perfil puede tener 0-1 conexión YouTube y 0-1 conexión BeatStars. Tracks y assets pertenecen a un perfil (no al usuario directamente).

---

## Cambios necesarios

### 1. Schema / BD

No se necesitan cambios de schema. Las tablas y columnas ya existen:
- `track.id_profile` (nullable) — ya existe en BD
- `asset.id_profile` (nullable) — ya existe en BD
- `profile_connections` — tabla completa ya existe
- `profiles` — tabla completa ya existe

Lo que sí hay que decidir:
- **Hacer `track.id_profile` NOT NULL?** Sí, eventualmente. Pero para la migración conviene dejarlo nullable y rellenarlo con los datos existentes primero (migration script).
- **Hacer `asset.id_profile` NOT NULL?** Mismo approach.

**Acción:** Crear un migration script que:
1. Para los usuarios existentes, cree un perfil por defecto si no tienen ninguno
2. Asigne `id_profile` a todos los tracks y assets que tengan `id_profile = NULL`, usando el perfil por defecto del usuario
3. Mueva las filas `oauth` existentes a `profile_connections` si aún no están vinculadas

### 2. Credential resolution — La pieza central

Actualmente `get_beatstars_token(user_id)` y `get_google_client(user_id)` buscan en `oauth` por `id_user`. Esto tiene que cambiar para que busquen por **perfil**:

**Nuevo flujo:**
```
get_beatstars_token(id_profile)
  1. db.profile_connections.findFirst({ id_profile, platform: 'BEATSTARS' })
  2. Obtener id_oauth de esa conexión
  3. db.oauth.findUnique({ id: id_oauth })
  4. Usar esas credenciales para obtener el token
```

```
get_google_client(id_profile)
  1. db.profile_connections.findFirst({ id_profile, platform: 'YOUTUBE' })
  2. Obtener id_oauth de esa conexión
  3. db.oauth.findUnique({ id: id_oauth })
  4. Crear el OAuth2 client con esas credenciales
```

**Archivos a modificar:**
- `src/api/beatstars-api.ts` — `get_beatstars_token(user_id)` → `get_beatstars_token(id_profile)`
- `src/google_auth.ts` — `get_google_client(user_id)` → `get_google_client(id_profile)`

### 3. Rutas de tracks — Scopear por perfil

Actualmente los endpoints de tracks filtran solo por `id_user`. Necesitan aceptar un `id_profile` y filtrar por él.

**`GET /api/tracks/pending`** (`tracks.router.ts:12`)
- Actualmente: `where: { yt_url: null, id_user: user.id }`
- Nuevo: Recibir `id_profile` como query param. Filtrar `where: { yt_url: null, id_profile }`. Verificar que el perfil pertenece al usuario.

**`POST /api/tracks`** (`tracks.router.ts:38`)
- Actualmente: `data: { id_user: user.id, ... }`
- Nuevo: Recibir `id_profile` en el body. Verificar que el perfil pertenece al usuario. Crear con `data: { id_user: user.id, id_profile, ... }`

**`PATCH /api/tracks/:id`** (`tracks.router.ts:116`)
- El ownership check ya va por `id_user`, eso está bien. No necesita cambiar mucho, pero verificar que el perfil del track coincide si se quiere ser estricto.

**`DELETE /api/tracks/:id`** (`tracks.router.ts:199`)
- Mismo caso que PATCH, el ownership va por `id_user`.

### 4. Rutas de assets — Scopear por perfil

**`POST /api/assets`** (`assets.router.ts:43`)
- Actualmente: `data: { id_user: user.id, ... }`
- Nuevo: Recibir `id_profile` en el body. Crear con `data: { id_user: user.id, id_profile, ... }`

**`GET /api/assets/:id`** (`assets.router.ts:104`)
- El ownership check va por `id_user`, está bien como fallback de seguridad.

### 5. Rutas de BeatStars — Usar credenciales del perfil

**`POST /api/bs/upload`** (`beatstars.routes.ts:13`)
- Actualmente: `get_beatstars_token(user.id)`
- Nuevo: Obtener el track/asset → sacar su `id_profile` → `get_beatstars_token(id_profile)`
- Si el asset no tiene perfil, error

**`POST /api/bs/publish`** (`beatstars.routes.ts:143`)
- Actualmente: `get_beatstars_token(user.id)`
- Nuevo: Obtener el track → sacar su `id_profile` → `get_beatstars_token(id_profile)`
- **Los tags/genres/bpm hardcodeados** (líneas 293-305) → leer de `profile_connections.meta` del perfil y mantener lo actual como fallback
- **La description** (vacía, línea 290) → podría venir de meta también y mantener lo actual como fallback

### 6. Rutas de Google/YouTube — Usar credenciales del perfil

**`GET /api/google/connect`** (`google.routes.ts:13`)
- Actualmente: `get_google_client(user.id)`
- Nuevo: Recibir `id_profile` como query param. Usar `get_google_client(id_profile)`.
- El `state` del OAuth debe codificar tanto `userId` como `id_profile` para que el callback sepa a qué perfil asociar el token.

**`GET /google/auth_callback`** (`app.ts:68`)
- Actualmente: `state` = `userId` como string
- Nuevo: `state` = `JSON.stringify({ userId, id_profile })` → parsear en el callback. Actualizar el `oauth.refresh_token` correcto (el que está vinculado via `profile_connections` al perfil).

**`POST /api/google/upload-youtube`** (`google.routes.ts:33`)
- Actualmente: `get_google_client(user.id)`
- Nuevo: Obtener el track → sacar su `id_profile` → `get_google_client(id_profile)`
- **La description del video** (línea 127) → leer de `profile_connections.meta.description` del perfil en lugar de hardcodear

### 7. Mappers — `db_track_to_track` necesita id_profile

`db_track_to_track` llama a `get_bs_track_by_id(db_track.id_user, ...)`. Esto tiene que cambiar a `get_bs_track_by_id(db_track.id_profile, ...)` ya que el token se resolverá por perfil.

**Archivo:** `src/mappers.ts:24-27`

### 8. Ruta de usuario — Reestructurar `UserInfo`

**`GET /api/user/info`** (`user.routes.ts:10`)

El campo `connections: { youtube: boolean, beatstars: boolean }` a nivel de usuario ya no tiene sentido (cada perfil tiene sus propias conexiones). Opciones:
- **Eliminar** `UserInfo.connections` del nivel usuario
- **Mantenerlo** como comodidad (hay algún oauth YOUTUBE/BEATSTARS en algún perfil del usuario) — pero es confuso

Recomendación: eliminarlo. El frontend debe mirar las conexiones de cada perfil individual.

### 9. Endpoints nuevos: CRUD de perfiles

Crear `src/routes/profiles.router.ts`:

**`GET /api/profiles`** — Listar perfiles del usuario
**`POST /api/profiles`** — Crear perfil
**`PATCH /api/profiles/:id`** — Editar nombre/settings
**`DELETE /api/profiles/:id`** — Borrar perfil (cascade borra tracks, assets, connections)

### 10. Endpoints nuevos: Gestión de conexiones por perfil

Posiblemente en el mismo router de perfiles o uno separado:

**`POST /api/profiles/:id/connections`** — Crear conexión (vincular un oauth a un perfil para una plataforma)
**`DELETE /api/profiles/:id/connections/:platform`** — Desvincular conexión
**`PATCH /api/profiles/:id/connections/:platform`** — Actualizar meta (tags, description)

### 11. Helper `get_profile` — Implementar

`src/utils.ts:171` tiene `get_profile()` declarada pero sin cuerpo. Implementarla:

```typescript
export async function get_profile(id_user: number, id_profile: string) {
  const profile = await db.profiles.findUnique({
    where: { id: id_profile },
    include: { profile_connections: true }
  })
  if (!profile) return api_error404('Profile not found')
  if (profile.id_user !== id_user) return api_error403('Profile does not belong to user')
  return profile
}
```

Usarla en todas las rutas que reciban `id_profile` para verificar ownership.

---

## Orden de implementación

El orden importa para no romper la app durante la migración:

### Fase 1: Preparar las bases (no rompe nada existente)
1. Implementar `get_profile()` en utils
2. Crear el CRUD de perfiles (`profiles.router.ts`)
3. Crear los endpoints de gestión de conexiones por perfil

### Fase 2: Migrar credenciales (cambio central)
4. Refactorizar `get_beatstars_token(id_profile)` — que busque por `profile_connections` → `oauth`
5. Refactorizar `get_google_client(id_profile)` — mismo approach
6. Actualizar `get_bs_track_by_id` para recibir `id_profile` en vez de `user_id`

### Fase 3: Migrar rutas (el código usa el nuevo sistema)
7. Actualizar `POST /api/tracks` para recibir y guardar `id_profile`
8. Actualizar `GET /api/tracks/pending` para filtrar por `id_profile`
9. Actualizar `POST /api/assets` para recibir y guardar `id_profile`
10. Actualizar `POST /api/bs/upload` para resolver credenciales por perfil del asset/track
11. Actualizar `POST /api/bs/publish` para resolver credenciales por perfil + leer meta (tags, etc.)
12. Actualizar `POST /api/google/upload-youtube` para resolver credenciales por perfil + leer meta (description)
13. Actualizar `GET /api/google/connect` para recibir `id_profile` + codificarlo en `state`
14. Actualizar `GET /google/auth_callback` para parsear `id_profile` del `state`
15. Actualizar mappers (`db_track_to_track`)
16. Actualizar `GET /api/user/info` — eliminar `connections` a nivel usuario

### Fase 4: Datos existentes
17. Migration script: crear perfiles por defecto, asignar `id_profile` a tracks/assets existentes, crear `profile_connections` a partir de `oauth` existentes

---

## Resumen de archivos a tocar

| Archivo | Cambio |
|---------|--------|
| `src/utils.ts` | Implementar `get_profile()` |
| `src/api/beatstars-api.ts` | `get_beatstars_token(id_profile)`, `get_bs_track_by_id(id_profile, ...)` |
| `src/google_auth.ts` | `get_google_client(id_profile)` |
| `src/routes/tracks.router.ts` | Recibir `id_profile`, filtrar y guardar por perfil |
| `src/routes/assets.router.ts` | Recibir `id_profile`, guardar por perfil |
| `src/routes/beatstars.routes.ts` | Resolver credenciales por perfil, leer meta |
| `src/routes/google.routes.ts` | Resolver credenciales por perfil, leer meta |
| `src/routes/app.ts` | Actualizar Google callback (parsear state con id_profile) |
| `src/routes/user.routes.ts` | Reestructurar UserInfo |
| `src/mappers.ts` | `db_track_to_track` usa id_profile para resolver BS |
| `src/types/types.ts` | Actualizar UserInfo, quizás BeatstarsMeta |
| `src/routes/profiles.router.ts` | **NUEVO** — CRUD perfiles + conexiones |
