const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');
const { sanitizeName } = require('./paymentProofStorage');
const { detectSubmissionType } = require('./submissionStorage');

/**
 * Archivos del material de apoyo (migración 103): guías, presentaciones y
 * notas de voz.
 *
 *   backend/storage/learning/<tenantId>/<uuid>.<ext>
 *
 * PRIVADOS (no se sirven como estáticos): la API verifica que quien los pide
 * sea el docente del tema o la familia de un alumno que ve ese tema.
 * El tipo se decide por la FIRMA BINARIA (como las entregas de tareas).
 */
const STORAGE_ROOT = path.join(__dirname, '..', '..', '..', 'storage');
const LEARNING_DIR = path.join(STORAGE_ROOT, 'learning');

const MAX_MATERIAL_BYTES = 25 * 1024 * 1024; // 25 MB (guías y presentaciones)
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB (≈ 5 minutos)

const startsWith = (buffer, bytes, offset = 0) =>
  buffer.length >= offset + bytes.length && buffer.subarray(offset, offset + bytes.length).equals(Buffer.from(bytes));

/** Audio por firma: MP3, OGG/Opus, WebM (lo que graba el navegador), M4A, WAV. */
function detectAudioType(buffer) {
  if (startsWith(buffer, [0x49, 0x44, 0x33]) || (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) return { ext: 'ogg', mime: 'audio/ogg' };
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { ext: 'webm', mime: 'audio/webm' };
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) return { ext: 'm4a', mime: 'audio/mp4' };
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x41, 0x56, 0x45], 8)) return { ext: 'wav', mime: 'audio/wav' };
  return null;
}

/** Clase de documento para el ícono y el visor. */
function kindOf(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (/presentation|powerpoint/.test(mime)) return 'presentation';
  if (/spreadsheet|excel/.test(mime)) return 'spreadsheet';
  return 'document';
}

/**
 * Valida y guarda el archivo. `audio` = true para notas de voz.
 * Devuelve los campos a guardar en learning_materials.
 */
async function saveMaterialFile(tenantId, { buffer, originalname }, { audio = false } = {}) {
  const type = audio ? detectAudioType(buffer) : detectSubmissionType(buffer, originalname);
  if (!type) {
    throw ApiError.badRequest(
      audio ? 'La nota de voz debe ser MP3, OGG, WebM, M4A o WAV.' : 'El archivo debe ser PDF, imagen JPG/PNG o un documento de Word, Excel o PowerPoint.',
      [{ path: 'file', message: 'Formato no permitido.' }]
    );
  }
  if (audio && buffer.length > MAX_AUDIO_BYTES) {
    throw ApiError.badRequest('La nota de voz no puede pesar más de 10 MB.', [{ path: 'file', message: 'Máximo 10 MB.' }]);
  }
  const dir = path.join(LEARNING_DIR, String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return {
    file_path: path.posix.join('learning', String(tenantId), fileName),
    file_mime: type.mime,
    file_original_name: sanitizeName(originalname || `material.${type.ext}`),
    file_size: buffer.length,
    kind: audio ? 'audio' : kindOf(type.mime),
  };
}

/** Ruta absoluta verificada (nunca fuera de storage/learning). */
function resolveMaterialFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('learning/')) return null;
  const absolute = path.resolve(STORAGE_ROOT, relativePath);
  return absolute.startsWith(LEARNING_DIR + path.sep) ? absolute : null;
}

async function deleteMaterialFile(relativePath) {
  const absolute = resolveMaterialFile(relativePath);
  if (!absolute) return;
  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('No se pudo borrar el archivo del material', relativePath, err.message);
  }
}

module.exports = { MAX_MATERIAL_BYTES, MAX_AUDIO_BYTES, detectAudioType, saveMaterialFile, resolveMaterialFile, deleteMaterialFile };
