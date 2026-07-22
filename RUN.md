# kynq gift backend

Standalone Express + MongoDB API that replaces the old Next.js `app/api/*` routes.

## Run
1. Backend:  `cd Backend && npm start`   → http://localhost:4000  (reads .env: MONGO_URI (Atlas), PORT=4000, CLIENT_URL)
2. Frontend: `cd StylenHomeWebsiteFrontend && npx next dev --turbopack --port 3009`

The frontend proxies `/api/*` → `http://localhost:4000` (next.config.mjs `rewrites` beforeFiles).
Override the backend URL with `API_BACKEND_URL` if needed.

Data (27 products, drops, bundles, journal, posts) auto-seeds into Mongo on first boot when empty.
Demo mode (no STRIPE_SECRET_KEY): checkout marks orders paid immediately. Magic-link URLs are logged to the backend console.
