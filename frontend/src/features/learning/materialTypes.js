/**
 * Catálogo de tipos de material de apoyo (mismos códigos que el backend, 103).
 * `tone`: clase de color de la tarjeta (learn-tone--*), definida en index.css.
 */
export const MATERIAL_TYPES = {
  file: { label: 'Guía o documento', short: 'Guía', icon: 'file', tone: 'file', verb: 'Abrir' },
  video: { label: 'Video', short: 'Video', icon: 'video', tone: 'video', verb: 'Ver' },
  link: { label: 'Enlace externo', short: 'Enlace', icon: 'link', tone: 'link', verb: 'Visitar' },
  audio: { label: 'Nota de voz', short: 'Audio', icon: 'headphones', tone: 'audio', verb: 'Escuchar' },
  pill: { label: 'Píldora de conocimiento', short: 'Píldora', icon: 'sparkles', tone: 'pill', verb: 'Leer' },
};

/** Etiqueta del documento según su clase (para los archivos). */
export const KIND_LABELS = { pdf: 'PDF', presentation: 'Presentación', document: 'Documento', spreadsheet: 'Hoja de cálculo', image: 'Imagen', audio: 'Audio' };

export const VISIBILITY = {
  draft: { label: 'Borrador', variant: 'neutral' },
  scheduled: { label: 'Programado', variant: 'info' },
  published: { label: 'Publicado', variant: 'success' },
};

/** Formatos para FileDropzone (el backend valida la firma real del archivo). */
export const DOCUMENT_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
};
export const AUDIO_ACCEPT = {
  'audio/mpeg': ['.mp3'],
  'audio/ogg': ['.ogg', '.oga', '.opus'],
  'audio/webm': ['.webm'],
  'audio/mp4': ['.m4a'],
  'audio/x-m4a': ['.m4a'],
  'audio/wav': ['.wav'],
};
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 300;

export const formatDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null);
