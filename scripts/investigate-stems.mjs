/**
 * Script Playwright para investigar cómo BeatStars añade stems a un track via API.
 * Usa las credenciales de la cuenta "dev" (perfil "test").
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/josep/.nvm/versions/node/v20.19.3/lib/node_modules/playwright');

const REFRESH_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImJ0cy1rZXktaWQifQ.eyJhdWQiOlsib2F1dGgyLXJlc291cmNlIl0sInVzZXJfbmFtZSI6Ik1SODQ5MTI0NiIsInNjb3BlIjpbInJlYWQiLCJ3cml0ZSIsInRydXN0Il0sImF0aSI6Ik9uRi00S09uSHhsZ2JyS2xZTFVnd252bzNLayIsImV4cCI6MTgwNDQyMjYwMSwiYXV0aG9yaXRpZXMiOlsiUk9MRV9VU0VSIl0sImp0aSI6IkozcGN4RElvdzRiYm5aaG53by1QRTZmZ1Z3SSIsImNsaWVudF9pZCI6IjU2MTU2NTYxMjcuYmVhdHN0YXJzLmNvbSJ9.aW96nD_2Wv3NanZ7mrXzTM49T5gQ5jZ4F4UA1kMruYPBwqYIu_gMAf3Kli09iDDxrrUTDFJ1gGkcFUoCtEB53JBIbr0zvDFmxJZwCG_rfeL-f-MpQ-sws6QNm-fQlSA_aALy1q-wN0KxFn8ipr49_LauSJjOMLRewHPTQoVDf5Jso0s-4Y7XpOO0s_EfFAhHLaQhR08sdKRBdgvna3jDEjVNeQytdz2ppC9qbJDkF9ssSaRQuSXkuHZrTFPybJsTinWlku2RikZ5BY0ztemOxItExA0L5x4trpfA4S2u-gjC0cfQPNukMBS5r57dXemuNQWtC6cFmIYQ3pClY8ZNXg";
const CLIENT_ID = "5615656127.beatstars.com";
const CLIENT_SECRET = "2a$16$b376aMFTHFXoI1XXa$5xXWHjnyZUP61sGr$GKwZjT$ApolQQW";

// 1. Obtener access_token via refresh
async function getAccessToken() {
  const body = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://core.prod.beatstars.net/auth/oauth/token", {
    method: "POST",
    body,
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error("Error obteniendo token:", JSON.stringify(data));
    process.exit(1);
  }
  console.log("✅ Token obtenido:", data.access_token.substring(0, 30) + "...");
  return data.access_token;
}

async function main() {
  const token = await getAccessToken();

  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext();

  // Interceptar todas las peticiones a BeatStars
  const capturedRequests = [];
  context.on('request', request => {
    const url = request.url();
    if (url.includes('beatstars.net') || url.includes('beatstars.com') || url.includes('uppy')) {
      const postData = request.postData();
      capturedRequests.push({
        url,
        method: request.method(),
        headers: request.headers(),
        postData: postData ? (() => { try { return JSON.parse(postData); } catch { return postData; } })() : null,
      });
    }
  });

  context.on('response', async response => {
    const url = response.url();
    if ((url.includes('beatstars.net') || url.includes('uppy')) && response.request().method() === 'POST') {
      try {
        const body = await response.json();
        const last = capturedRequests[capturedRequests.length - 1];
        if (last) last.response = body;
      } catch {}
    }
  });

  const page = await context.newPage();

  // Ir a BeatStars e inyectar el token en localStorage
  await page.goto('https://studio.beatstars.com');
  await page.evaluate((tkn) => {
    localStorage.setItem('access_token', tkn);
    // BeatStars usa estos keys típicos:
    localStorage.setItem('token', tkn);
    localStorage.setItem('beatstars_token', tkn);
  }, token);

  // Inyectar cookie de autenticación
  await context.addCookies([
    {
      name: 'access_token',
      value: token,
      domain: '.beatstars.com',
      path: '/',
    }
  ]);

  console.log("\n🎵 Abre BeatStars Studio en el navegador.");
  console.log("📌 Navega a un track y añade stems. Capturando peticiones de red...");
  console.log("⏳ El script espera 3 minutos para que hagas la acción.\n");

  // Esperar 3 minutos para que el usuario haga la acción
  await page.waitForTimeout(3 * 60 * 1000);

  // Guardar los requests capturados
  const fs = await import('fs');
  const output = JSON.stringify(capturedRequests, null, 2);
  fs.writeFileSync('/tmp/beatstars-stems-requests.json', output);
  console.log(`\n✅ Guardadas ${capturedRequests.length} peticiones en /tmp/beatstars-stems-requests.json`);

  // Mostrar las más relevantes (relacionadas con stems)
  const stemRequests = capturedRequests.filter(r =>
    JSON.stringify(r).toLowerCase().includes('stem')
  );
  if (stemRequests.length > 0) {
    console.log("\n🔍 Peticiones relacionadas con STEMS:");
    console.log(JSON.stringify(stemRequests, null, 2));
  } else {
    console.log("\n⚠️  No se detectaron peticiones con 'stem'. Mostrando todas las POST a GraphQL:");
    const gql = capturedRequests.filter(r => r.url.includes('graphql'));
    console.log(JSON.stringify(gql, null, 2));
  }

  await browser.close();
}

main().catch(console.error);
