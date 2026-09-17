// GIF search/trending for Kynq Extra's in-call "Memes" panel, proxied
// server-side so the API key never reaches the browser and results are
// filtered to G-rated content.
//
// GIPHY's old published "public beta key" (dc6zaTOxFJmzC), previously
// usable without signing up, is now dead — confirmed directly against
// their API (403 BANNED). Every mainstream GIF provider (GIPHY, Tenor)
// requires a real key; there's no keyless option anymore. Get a free key
// at https://developers.giphy.com (instant approval, no cost, ~2 minutes)
// and set GIPHY_API_KEY — until then this reports { configured: false }
// instead of failing with a confusing error.
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || null;
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

export const giphyConfigured = !!GIPHY_API_KEY;

function normalizeGif(g) {
  return {
    id: g.id,
    title: g.title,
    previewUrl: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url,
    url: g.images?.fixed_width?.url ?? g.images?.original?.url,
    width: Number(g.images?.fixed_width?.width) || undefined,
    height: Number(g.images?.fixed_width?.height) || undefined,
  };
}

export async function searchGifs(query, limit = 24) {
  const url = `${GIPHY_BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`giphy search failed (${res.status})`);
  const json = await res.json();
  return (json.data ?? []).map(normalizeGif);
}

export async function trendingGifs(limit = 24) {
  const url = `${GIPHY_BASE}/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=g`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`giphy trending failed (${res.status})`);
  const json = await res.json();
  return (json.data ?? []).map(normalizeGif);
}
