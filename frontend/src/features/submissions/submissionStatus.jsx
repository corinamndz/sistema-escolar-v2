import { useEffect, useState } from 'react';
import Badge from '../../components/ui/Badge';
import { fileNameFrom, saveBlob } from '../../utils/download';

/**
 * Aula virtual: estados de una entrega (los mismos códigos del backend).
 *   pending    la familia debe entregar (o el docente la devolvió para corregir)
 *   submitted  entregada, esperando calificación
 *   graded     calificada
 */
export const SUBMISSION_STATUS = {
  pending: { label: 'Pendiente', variant: 'warning' },
  submitted: { label: 'Entregada', variant: 'info' },
  graded: { label: 'Calificada', variant: 'success' },
};

/** Insignia del estado. Una entrega devuelta (pendiente con archivo) se distingue. */
export function SubmissionBadge({ status, submission }) {
  if (status === 'pending' && submission?.has_file) return <Badge variant="danger">Devuelta para corregir</Badge>;
  const s = SUBMISSION_STATUS[status] || SUBMISSION_STATUS.pending;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const DATE_TIME = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const DAY_ONLY = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });

/** Fecha de calendario 'YYYY-MM-DD' → "mié 18 nov" (sin hora ni corrimiento por zona horaria). */
export const formatDay = (ymd) => (ymd ? DAY_ONLY.format(new Date(`${ymd}T12:00:00`)) : null);

/** "vie 20 nov, 6:00 p. m." en la zona horaria del navegador. */
export const formatDateTime = (iso) => (iso ? DATE_TIME.format(new Date(iso)) : '—');

/** Tiempo restante legible: "faltan 3 días", "faltan 5 h", "venció". */
export function timeLeft(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'venció';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `faltan ${Math.floor(hours / 24)} días`;
  if (hours >= 1) return `faltan ${hours} h`;
  return `faltan ${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/** Margen (en días) por debajo del cual una tarea está "próxima a vencer". */
export const SOON_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * Semáforo de la fecha límite de una tarea pendiente:
 *   overdue  🔴 la hora límite ya pasó
 *   soon     🟡 quedan SOON_DAYS días (72 h) o menos
 *   ontime   🟢 más de SOON_DAYS días de margen
 * Devuelve { level, label, detail } (el texto acompaña al color: nunca solo color).
 */
export function deadlineSignal(deadline, now = Date.now()) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { level: 'overdue', label: 'Vencida', detail: 'Aún puedes entregarla: quedará marcada fuera de plazo.' };
  if (ms <= SOON_DAYS * DAY_MS) return { level: 'soon', label: 'Próxima a vencer', detail: timeLeft(deadline, now) };
  return { level: 'ontime', label: 'A tiempo', detail: timeLeft(deadline, now) };
}

/** Hora actual que se actualiza sola (por defecto cada minuto): el semáforo cambia sin recargar. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** ISO (UTC) → valor de <input type="datetime-local"> en hora local. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> (hora local) → ISO con zona, para el backend. */
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

export const formatBytes = (bytes) => (!bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Descarga un archivo entregado ({ blob, headers } de la API) con su nombre original. */
export function saveDownloaded({ blob, headers }, fallback = 'tarea') {
  saveBlob(blob, fileNameFrom(headers, fallback));
}

/** Formatos aceptados para FileDropzone (el backend valida la firma real del archivo). */
export const SUBMISSION_ACCEPT = {
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
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
