const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');
const { sanitizeName } = require('./paymentProofStorage');

/**
 * Archivos de las entregas de tareas (aula virtual, migración 101).
 *
 *   backend/storage/submissions/<tenantId>/<uuid>.<ext>
 *
 * PRIVADOS: la carpeta no se sirve como estática. Se descargan solo por la API
 * (bandeja del docente o portal del representante), que verifica permisos.
 *
 * El tipo se decide por la FIRMA BINARIA, no por la extensión ni el mimetype
 * del navegador. Los formatos de Office modernos (docx/xlsx/pptx) son un ZIP:
 * para ellos se exige además la extensión correspondiente, y el archivo se
 * descarga siempre como adjunto (nunca se interpreta en el navegador).
 */
const STORAGE_ROOT = path.join(__dirname, '..', '..', '..', 'storage');
const SUBMISSIONS_DIR = path.join(STORAGE_ROOT, 'submissions');

const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024; // 10 MB

const OFFICE_ZIP = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const OFFICE_LEGACY = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };

const startsWith = (buffer, bytes) => buffer.length >= bytes.length && buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));

/** { ext, mime } según el contenido real, o null si no es un formato permitido. */
function detectSubmissionType(buffer, originalName = '') {
  const ext = path.extname(String(originalName)).slice(1).toLowerCase();
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  // ZIP (PK\x03\x04): solo como documento de Office con su extensión.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && OFFICE_ZIP[ext]) return { ext, mime: OFFICE_ZIP[ext] };
  // OLE2 (Office 97-2003).
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && OFFICE_LEGACY[ext]) return { ext, mime: OFFICE_LEGACY[ext] };
  return null;
}

/** Valida y guarda el archivo. Devuelve los campos a persistir en `evaluation_submissions`. */
async function saveSubmissionFile(tenantId, { buffer, originalname }) {
  const type = detectSubmissionType(buffer, originalname);
  if (!type) {
    throw ApiError.badRequest('El archivo debe ser PDF, imagen JPG/PNG o un documento de Word, Excel o PowerPoint.', [
      { path: 'file', message: 'Formato no permitido.' },
    ]);
  }
  const dir = path.join(SUBMISSIONS_DIR, String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return {
    file_path: path.posix.join('submissions', String(tenantId), fileName),
    file_mime: type.mime,
    file_original_name: sanitizeName(originalname || `tarea.${type.ext}`),
    file_size: buffer.length,
  };
}

/** Ruta absoluta verificada (nunca fuera de storage/submissions). */
function resolveSubmissionFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('submissions/')) return null;
  const absolute = path.resolve(STORAGE_ROOT, relativePath);
  return absolute.startsWith(SUBMISSIONS_DIR + path.sep) ? absolute : null;
}

async function deleteSubmissionFile(relativePath) {
  const absolute = resolveSubmissionFile(relativePath);
  if (!absolute) return;
  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('No se pudo borrar el archivo de la entrega', relativePath, err.message);
  }
}

module.exports = { MAX_SUBMISSION_BYTES, detectSubmissionType, saveSubmissionFile, resolveSubmissionFile, deleteSubmissionFile };
