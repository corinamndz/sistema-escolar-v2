/**
 * Videos de YouTube y Vimeo (misma regla que learning.service.parseVideoUrl):
 * reconocer el enlace al pegarlo y armar la URL del reproductor embebido.
 * YouTube se embebe desde youtube-nocookie.com (sin cookies de seguimiento
 * hasta que se reproduce).
 */
export function parseVideoUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const ytId = /^[A-Za-z0-9_-]{11}$/;
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ytId.test(id) ? { provider: 'youtube', video_id: id } : null;
  }
  if (['youtube.com', 'youtube-nocookie.com', 'music.youtube.com'].includes(host)) {
    const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1];
    return id && ytId.test(id) ? { provider: 'youtube', video_id: id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/)?.[1];
    return id ? { provider: 'vimeo', video_id: id } : null;
  }
  return null;
}

export function embedUrl({ provider, video_id: id }) {
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1`;
  if (provider === 'vimeo') return `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1`;
  return null;
}

/** Miniatura (solo YouTube la expone sin API). */
export const thumbnailUrl = ({ provider, video_id: id }) => (provider === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : null);
