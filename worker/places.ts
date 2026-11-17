// Recherches externes, relayées par le serveur et gardées en cache une journée (cache de Cloudflare, gratuit,
// sans écriture KV) :
// - salles de sport autour d'un point, partout dans le monde, depuis OpenStreetMap (Overpass) ;
// - une ville ou une adresse en position (Nominatim), pour qui refuse la localisation ;
// - musiques pour les publications du club : Apple Music et Deezer (extraits de 30 s, sans clé), et les liens
//   SoundCloud collés (morceau entier dans le lecteur de SoundCloud).
import { type Env, HttpError, json } from './env';
import { capDaily } from './usage';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  brand?: string;
  /** Distance au point demandé, en mètres. */
  distance: number;
}

export type MusicSource = 'apple' | 'deezer' | 'soundcloud';

export interface Track {
  /** Absent sur les anciennes publications : Apple Music. */
  source?: MusicSource;
  id: string;
  title: string;
  artist: string;
  artwork: string;
  preview?: string;
  link: string;
}

const UA = 'Shred/1.0 (private fitness app)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Requête Overpass : salles de fitness (et centres sportifs orientés muscu) autour du point. */
export function overpassQuery(lat: number, lon: number, radius: number, name?: string): string {
  const n = name ? `["name"~"${name.replace(/[\\"^$.*+?()[\]{}|]/g, '')}",i]` : '';
  const around = `(around:${radius},${lat},${lon})`;
  return `[out:json][timeout:20];(nwr["leisure"="fitness_centre"]${n}${around};nwr["leisure"="sports_centre"]["sport"~"fitness|bodybuilding|crossfit|weightlifting|boxing|martial_arts"]${n}${around};nwr["amenity"="gym"]${n}${around};);out center tags 60;`;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function toPlaces(elements: OsmElement[], from: { lat: number; lon: number }): Place[] {
  const out: Place[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const t = e.tags ?? {};
    if (lat === undefined || lon === undefined) continue;
    const name = t.name || t.brand || t.operator;
    if (!name) continue;
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const address = [street, t['addr:city']].filter(Boolean).join(', ');
    out.push({
      id: `osm:${e.type[0]}${e.id}`,
      name: name.slice(0, 80),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      ...(address ? { address: address.slice(0, 120) } : {}),
      ...(t.brand ? { brand: t.brand.slice(0, 40) } : {}),
      distance: distanceM(from, { lat, lon }),
    });
  }
  // Une même salle peut être à la fois un point et un bâtiment : un seul résultat par nom à moins de 300 m.
  const kept: Place[] = [];
  for (const p of out.sort((a, b) => a.distance - b.distance)) {
    const twin = kept.find((k) => k.name.toLowerCase() === p.name.toLowerCase() && distanceM(k, p) < 300);
    if (!twin) kept.push(p);
    else {
      twin.address ??= p.address;
      twin.brand ??= p.brand;
    }
  }
  return kept.slice(0, 30);
}

export function toTracks(results: Record<string, unknown>[]): Track[] {
  return results
    .filter((r) => r.kind === 'song' && r.trackId && r.trackViewUrl)
    .map((r) => ({
      source: 'apple' as const,
      id: String(r.trackId),
      title: String(r.trackName ?? '').slice(0, 100),
      artist: String(r.artistName ?? '').slice(0, 80),
      artwork: String(r.artworkUrl100 ?? '').replace('100x100bb', '300x300bb'),
      ...(r.previewUrl ? { preview: String(r.previewUrl) } : {}),
      link: String(r.trackViewUrl),
    }));
}

interface DeezerTrack {
  id: number;
  title?: string;
  title_short?: string;
  link?: string;
  preview?: string;
  artist?: { name?: string };
  album?: { cover_medium?: string; cover_big?: string };
}

export function fromDeezer(data: DeezerTrack[]): Track[] {
  return data
    .filter((d) => d.id && d.link)
    .map((d) => ({
      source: 'deezer' as const,
      id: String(d.id),
      title: String(d.title_short || d.title || '').slice(0, 100),
      artist: String(d.artist?.name ?? '').slice(0, 80),
      artwork: String(d.album?.cover_medium ?? ''),
      // L'extrait de Deezer expire au bout de quelques heures : il est redemandé au moment de l'écouter.
      ...(d.preview ? { preview: d.preview } : {}),
      link: String(d.link),
    }));
}

/** Apple d'abord, puis Deezer, sans doublon (même titre et même artiste). */
export function mergeTracks(lists: Track[][]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of lists.flat()) {
    const k = `${t.title}|${t.artist}`.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 20);
}

const safeUrl = (v: unknown, hosts: RegExp) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' && hosts.test(u.hostname) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** Seules les adresses d'Apple, de Deezer et de SoundCloud sont acceptées dans une publication. */
export function sanitizeTrack(raw: unknown): Track | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const base = { title: String(t.title ?? '').slice(0, 100), artist: String(t.artist ?? '').slice(0, 80) };
  if (t.source === 'deezer') {
    const id = String(t.id ?? '');
    const link = safeUrl(t.link, /^(www\.)?deezer\.com$/);
    const artwork = safeUrl(t.artwork, /(^|\.)dzcdn\.net$/) ?? '';
    if (!/^\d{1,15}$/.test(id) || !link) return undefined;
    return { source: 'deezer', id, ...base, artwork, link };
  }
  if (t.source === 'soundcloud') {
    const link = safeUrl(t.link, /^soundcloud\.com$/);
    const artwork = safeUrl(t.artwork, /(^|\.)sndcdn\.com$/) ?? '';
    if (!link) return undefined;
    return { source: 'soundcloud', id: link, ...base, artwork, link };
  }
  const url = safeUrl;
  const id = String(t.id ?? '');
  const artwork = url(t.artwork, /(^|\.)mzstatic\.com$/);
  const link = url(t.link, /^(music|itunes)\.apple\.com$/);
  const preview = url(t.preview, /(^|\.)(apple\.com|mzstatic\.com)$/);
  if (!/^\d{1,15}$/.test(id) || !artwork || !link) return undefined;
  return {
    source: 'apple',
    id,
    title: String(t.title ?? '').slice(0, 100),
    artist: String(t.artist ?? '').slice(0, 80),
    artwork,
    link,
    ...(preview ? { preview } : {}),
  };
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const req = new Request(`https://cache.shred/${encodeURIComponent(key)}`);
  const hit = cache && (await cache.match(req).catch(() => undefined));
  if (hit) return (await hit.json()) as T;
  const value = await load();
  if (cache) await cache.put(req, new Response(JSON.stringify(value), { headers: { 'cache-control': `max-age=${ttl}` } })).catch(() => undefined);
  return value;
}

const num = (v: string | null, min: number, max: number) => {
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export async function placeRoutes(req: Request, env: Env, pathname: string, userId = ''): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  const url = new URL(req.url);
  const fetcher = (env as Env & { FETCH?: typeof fetch }).FETCH ?? fetch;

  if (pathname === '/api/places/gyms' || pathname === '/api/places/geocode') await capDaily(env, userId, 'places');
  if (pathname.startsWith('/api/music/')) await capDaily(env, userId, 'music');

  if (pathname === '/api/places/gyms') {
    const lat = num(url.searchParams.get('lat'), -90, 90);
    const lon = num(url.searchParams.get('lon'), -180, 180);
    if (lat === null || lon === null) throw new HttpError(400, 'Position manquante');
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);
    // Arrondi à ~100 m : moins précis côté vie privée, et le cache sert à plusieurs personnes.
    const p = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
    const radius = q ? 25_000 : 4_000;
    const places = await cached(`gyms:${p.lat},${p.lon}:${q.toLowerCase()}`, 86_400, async () => {
      const body = `data=${encodeURIComponent(overpassQuery(p.lat, p.lon, radius, q || undefined))}`;
      for (const endpoint of OVERPASS) {
        const res = await fetcher(endpoint, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA } }).catch(() => null);
        if (res?.ok) return toPlaces(((await res.json()) as { elements: OsmElement[] }).elements ?? [], p);
      }
      throw new HttpError(502, 'La carte des salles ne répond pas, réessaie dans un instant');
    });
    return json({ places });
  }

  if (pathname === '/api/places/geocode') {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (q.length < 2) throw new HttpError(400, 'Tape une ville ou une adresse');
    const hit = await cached(`geo:${q.toLowerCase()}`, 7 * 86_400, async () => {
      const res = await fetcher(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`, {
        headers: { 'user-agent': UA },
      });
      if (!res.ok) throw new HttpError(502, 'Recherche de lieu indisponible');
      const [r] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      return r ? { lat: Number(r.lat), lon: Number(r.lon), label: r.display_name.split(',').slice(0, 3).join(',') } : null;
    });
    if (!hit) throw new HttpError(404, 'Lieu introuvable');
    return json(hit);
  }

  if (pathname === '/api/music/search') {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (q.length < 2) return json({ tracks: [] });
    const country = /^[A-Z]{2}$/.test(url.searchParams.get('country') ?? '') ? url.searchParams.get('country') : 'FR';
    const result = await cached(`music2:${country}:${q.toLowerCase()}`, 3 * 3600, async () => {
      const failed: string[] = [];
      const [apple, deezer] = await Promise.all([
        fetcher(`https://itunes.apple.com/search?media=music&entity=song&limit=12&country=${country}&term=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(3500) })
          .then(async (res) => (res.ok ? toTracks(((await res.json()) as { results: Record<string, unknown>[] }).results ?? []) : (failed.push(`Apple ${res.status}`), [])))
          .catch(() => (failed.push('Apple réseau'), [] as Track[])),
        fetcher(`https://api.deezer.com/search?limit=12&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(3500) })
          .then(async (res) => (res.ok ? fromDeezer(((await res.json()) as { data?: DeezerTrack[] }).data ?? []) : (failed.push(`Deezer ${res.status}`), [])))
          .catch(() => (failed.push('Deezer réseau'), [] as Track[])),
      ]);
      if (failed.length === 2) throw new HttpError(502, 'Recherche de musique indisponible ({services})', { services: failed.join(', ') });
      return { tracks: mergeTracks([apple, deezer]) };
    });
    return json(result);
  }

  // Extrait Deezer frais, au moment de l'écouter (ceux de Deezer expirent).
  const dz = pathname.match(/^\/api\/music\/deezer\/(\d{1,15})$/);
  if (dz) {
    const preview = await cached(`dz:${dz[1]}`, 1800, async () => {
      const res = await fetcher(`https://api.deezer.com/track/${dz[1]}`, { headers: { 'user-agent': UA } });
      const d = res.ok ? ((await res.json()) as { preview?: string }) : {};
      return safeUrl(d.preview, /(^|\.)dzcdn\.net$/) ?? null;
    });
    if (!preview) throw new HttpError(404, 'Extrait indisponible');
    return json({ preview });
  }

  // Lien SoundCloud collé : titre, artiste et pochette par l'oEmbed public de SoundCloud.
  if (pathname === '/api/music/soundcloud') {
    let link = safeUrl(url.searchParams.get('url'), /^(soundcloud\.com|on\.soundcloud\.com|m\.soundcloud\.com)$/);
    if (!link) throw new HttpError(400, 'Colle un lien soundcloud.com');
    const track = await cached(`sc:${link}`, 86_400, async () => {
      if (new URL(link!).hostname !== 'soundcloud.com') {
        // Lien court de l'app SoundCloud : on suit la redirection jusqu'au vrai morceau.
        const r = await fetcher(link!, { redirect: 'follow', headers: { 'user-agent': UA } });
        link = safeUrl(r.url.replace('://m.', '://'), /^soundcloud\.com$/);
        if (!link) throw new HttpError(400, 'Lien SoundCloud introuvable');
      }
      const clean = link!.split('?')[0];
      const res = await fetcher(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(clean)}`, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new HttpError(404, 'Morceau SoundCloud introuvable ou privé');
      const o = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      const title = String(o.title ?? '').replace(new RegExp(` by ${String(o.author_name ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      return sanitizeTrack({ source: 'soundcloud', title, artist: o.author_name, artwork: o.thumbnail_url, link: clean }) ?? null;
    });
    if (!track) throw new HttpError(404, 'Morceau SoundCloud introuvable');
    return json({ track });
  }

  return null;
}
