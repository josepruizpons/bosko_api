# Plan: BeatStars OAuth via Playwright

## Contexto

Actualmente añadir una conexión BeatStars a un perfil requiere tener un `oauth` pre-existente
en la base de datos con `client_id`, `client_secret` y `refresh_token` de BeatStars. No hay
ningún flujo automatizado para obtener esas credenciales.

El objetivo es crear un endpoint que, dado el email y password de BeatStars del usuario:
1. Lance un browser headless con Playwright
2. Complete el flujo de login de BeatStars en dos pasos (email → password)
3. Intercepte la petición de refresh token que el navegador hace automáticamente antes del submit final
4. Extraiga `refresh_token`, `client_id` y `client_secret` del body de esa petición
5. Persista esos datos en BD, creando el `oauth` y el `profile_connections`

**Compliance:** El email y password se usan exclusivamente en memoria durante la sesión de
Playwright. No se persisten, no se loggean, no se pasan a ninguna función secundaria.

---

## La petición que se intercepta

Cuando el usuario va a hacer submit del password en el paso 2 del login, BeatStars lanza
automáticamente esta petición **antes** de que el usuario pulse Continue:

```
POST https://core.prod.beatstars.net/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

refresh_token=eyJ...&client_id=5615656127.beatstars.com&client_secret=2a$16$...&grant_type=refresh_token
```

**Lo que nos interesa extraer del request body:**

| Campo | Descripción |
|-------|-------------|
| `refresh_token` | Token de larga duración — lo que `get_beatstars_token()` usa para obtener access tokens |
| `client_id` | Identificador de la app OAuth de BeatStars del usuario |
| `client_secret` | Secret de la app OAuth del usuario |

No es necesario leer la response. Los 3 campos que se quieren persistir están todos en el
**request body**. El `access_token` (cabecera `Authorization` del request) caduca en minutos
y no se guarda; `get_beatstars_token()` ya lo obtiene fresco en cada uso mediante el refresh.

---

## Flujo de la UI de BeatStars

El login de BeatStars OAuth es un flujo de dos páginas:

### Página 1 — `https://oauth.beatstars.com/verify`

Contiene un input de email:
```html
<input type="email" id="oath-email" placeholder="Type your email or username" />
```

Y un botón de continuar:
```html
<button type="submit" class="bs-btn action-element"><span>Continue</span></button>
```

Al hacer submit navega a la página 2.

### Página 2 — `https://oauth.beatstars.com/login`

Contiene un input de password:
```html
<input type="password" id="userPassword" placeholder="Type your password" />
```

Y un botón de continuar:
```html
<button type="submit" class="bs-btn action-element"><span>Continue</span></button>
```

**La petición OAuth a interceptar se dispara antes del submit de esta página.**
Por tanto, el interceptor debe estar activo desde el inicio, y la captura ocurre
mientras el usuario (Playwright) está en la página 2, antes o justo al hacer click en Continue.

---

## Endpoint

```
POST /api/profiles/:id/connections/beatstars
```

Se añade en `src/routes/profiles.router.ts`. Protegido por `validate_session` (igual que el
resto de `/api`).

### Request

```json
{
  "email": "user@beatstars.com",
  "password": "su_password_de_beatstars"
}
```

### Response `201`

El perfil actualizado, igual que devuelve el resto de endpoints de conexión:

```json
{
  "id": "abc123",
  "name": "Mi Perfil",
  "connections": [
    { "platform": "BEATSTARS", "is_active": true, "meta": {} }
  ]
}
```

### Errores posibles

| Status | Causa |
|--------|-------|
| `400` | Falta `email` o `password` en el body |
| `400` | Ya existe una conexión BEATSTARS para este perfil |
| `403` | El perfil no pertenece al usuario autenticado |
| `404` | Perfil no encontrado |
| `500` | Playwright no pudo completar el login (credenciales incorrectas, timeout, cambio en la UI de BS) |
| `500` | No se interceptó la petición OAuth en el tiempo esperado |

---

## Implementación

### Paso 1 — Instalar Playwright

```bash
npm install playwright
npx playwright install chromium
```

Dependencia de producción: el endpoint se ejecuta en el servidor.

---

### Paso 2 — `src/api/beatstars-playwright.ts` (archivo nuevo)

Módulo responsable de toda la lógica de Playwright. Exporta una sola función:

```ts
export interface BeatStarsOAuthResult {
  refresh_token: string
  client_id: string
  client_secret: string
}

export async function getBeatStarsTokensViaPlaywright(
  email: string,
  password: string
): Promise<BeatStarsOAuthResult>
```

**Flujo interno paso a paso:**

1. Lanzar `chromium` en modo headless
2. Registrar `page.on('request', handler)` **antes** de navegar — el handler filtra:
   - URL exacta: `https://core.prod.beatstars.net/auth/oauth/token`
   - Método: `POST`
   - Body form-urlencoded con `grant_type=refresh_token`
   - Cuando se captura, parsea el body y resuelve la Promise con `{ refresh_token, client_id, client_secret }`
3. Navegar a `https://oauth.beatstars.com/verify`
4. Esperar a que `#oath-email` esté visible y rellenar con el email
5. Hacer click en `button[type="submit"]` y esperar navegación a `/login`
6. Esperar a que `#userPassword` esté visible y rellenar con el password
7. Hacer click en `button[type="submit"]`
8. Esperar a que se resuelva la capturePromise (con timeout de 30s en race) — **la petición OAuth se dispara después del click, el interceptor la captura en este await**
9. Cerrar el browser (siempre en `finally`)
10. Devolver `{ refresh_token, client_id, client_secret }`

**Implementación del interceptor con Promise:**

```ts
let resolveCapture!: (result: BeatStarsOAuthResult) => void
const capturePromise = new Promise<BeatStarsOAuthResult>((res) => {
  resolveCapture = res
})

page.on('request', (request) => {
  if (
    request.url() === 'https://core.prod.beatstars.net/auth/oauth/token' &&
    request.method() === 'POST'
  ) {
    const body = new URLSearchParams(request.postData() ?? '')
    if (body.get('grant_type') !== 'refresh_token') return
    resolveCapture({
      refresh_token: body.get('refresh_token') ?? '',
      client_id: body.get('client_id') ?? '',
      client_secret: body.get('client_secret') ?? '',
    })
  }
})

const timeout = new Promise<never>((_, rej) =>
  setTimeout(() => rej(new Error('BeatStars OAuth capture timed out after 30s')), 30_000)
)

// Paso 1: email
await page.goto('https://oauth.beatstars.com/verify')
await page.waitForSelector('#oath-email')
await page.fill('#oath-email', email)
await page.click('button[type="submit"]')

// Paso 2: password
await page.waitForURL('**/login')
await page.waitForSelector('#userPassword')
await page.fill('#userPassword', password)

// Click dispara la petición; el interceptor la captura asíncronamente
await page.click('button[type="submit"]')

// Esperar a que el interceptor resuelva la Promise (la petición llega tras el submit)
const result = await Promise.race([capturePromise, timeout])
```

**Gestión de errores:**
- Browser siempre se cierra en `finally` — no quedan procesos zombi
- Si la petición OAuth no aparece antes del timeout → error descriptivo
- Si algún selector no se encuentra → Playwright lanza `TimeoutError` con contexto

---

### Paso 3 — Nuevo endpoint en `profiles.router.ts`

```
POST /api/profiles/:id/connections/beatstars
```

**Flujo del handler:**

1. `get_current_user(req)` — verificar sesión
2. `get_profile(user.id, id_profile)` — verificar que el perfil existe y pertenece al usuario
3. Validar que `email` y `password` son strings no vacíos; si no → `api_error400`
4. Comprobar en BD que no existe ya una conexión BEATSTARS para este perfil:
   ```ts
   db.profile_connections.findUnique({
     where: { id_profile_platform: { id_profile, platform: 'BEATSTARS' } }
   })
   ```
   Si existe → `api_error400('Profile already has a BEATSTARS connection')`
5. Llamar a `getBeatStarsTokensViaPlaywright(email, password)`
   — a partir de aquí las credenciales ya no se usan ni referencian
6. Crear el registro `oauth` en BD:
   ```ts
   db.oauth.create({
     data: {
       id_user: user.id,
       connection_type: 'BEATSTARS',
       access_token: null,        // no se guarda; se obtiene fresco en cada uso via refresh
       refresh_token: result.refresh_token,
       client_id: result.client_id,
       client_secret: result.client_secret,
     }
   })
   ```
7. Crear el `profile_connections`:
   ```ts
   db.profile_connections.create({
     data: {
       id: generate_id(),
       id_profile,
       id_oauth: oauth.id,
       platform: PLATFORMS.BEATSTARS,
       meta: {},
     }
   })
   ```
8. Consultar el perfil actualizado y devolverlo con `db_profile_to_profile`

---

## Archivos a crear / modificar

| Archivo | Acción |
|---------|--------|
| `package.json` | Añadir `playwright` como dependencia |
| `src/api/beatstars-playwright.ts` | **NUEVO** — lógica de Playwright |
| `src/routes/profiles.router.ts` | Añadir `POST /:id/connections/beatstars` |

Sin cambios en BD, sin migraciones, sin cambios en otros routers.

---

## Notas de compliance y seguridad

- `email` y `password` solo existen como parámetros de `getBeatStarsTokensViaPlaywright`.
  Una vez devuelto el resultado, JS los libera para GC. No se pasan a ninguna otra función.
- No se añaden a logs (`console.log`, `console.error`, etc.) en ningún punto del flujo.
- La transmisión del endpoint al servidor está protegida por HTTPS.
- Solo se persiste en BD lo que BeatStars envía en la petición de refresh token:
  `refresh_token`, `client_id`, `client_secret`. Son credenciales de la app OAuth,
  no las credenciales del usuario (email/password).
- Si Playwright falla antes de completar, no se crea ningún registro en BD.
