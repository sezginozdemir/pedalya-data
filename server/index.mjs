// Giris noktasi: parcalari birlestirir, sunucuyu baslatir ve duzgun kapatir.
import { createApp } from './app.mjs';
import { openCommunity } from './community.mjs';
import { config } from './config.mjs';
import { log } from './lib.mjs';
import { createFallback } from './providers/fallback.mjs';
import { createGeocoder } from './providers/geocoder.mjs';
import { createRouter } from './providers/router.mjs';
import { createRoutes } from './routes.mjs';
import { openStore } from './store.mjs';

const store = openStore();
const community = openCommunity();
const { userAgent, version } = config;

const routes = createRoutes({
  store,
  community,
  version,
  geocoder: createGeocoder({ url: config.nominatimUrl, userAgent, delayMs: config.nominatimDelayMs }),
  router: createRouter({ url: config.brouterUrl, userAgent }),
  fallback: createFallback({ cacheDir: config.cacheDir, userAgent }),
});

const server = createApp({ routes, config });

server.listen(config.port, config.host, () => {
  log('started', { host: config.host, port: config.port, version, trustProxy: config.trustProxy });
  console.log(`Pedalya: http://localhost:${config.port}`);
});

let stopping = false;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('stopping', { signal });
  server.close(() => {
    store.close();
    community.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // Takilan baglanti kapanisi engellemesin
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
