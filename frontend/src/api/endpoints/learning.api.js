import { axiosClient } from '../axiosClient';

/** Envía JSON o, si hay archivo, multipart (los campos van como texto). */
function body(data, file) {
  if (!file) return data;
  const form = new FormData();
  Object.entries(data).forEach(([k, v]) => v !== undefined && form.append(k, v === null ? '' : String(v)));
  form.append('file', file);
  return form;
}
const config = (file, onProgress) =>
  file
    ? {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: onProgress ? (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) : undefined,
      }
    : undefined;

/**
 * Material de apoyo del contenido programático.
 *   Docente: /learning/…           Familia y modo alumno: /portal/students/:id/learning/…
 */
const learningApi = {
  // ---- Docente ----
  /** { content, students, materials: [...] } */
  listMaterials: (contentId) => axiosClient.get(`/learning/contents/${contentId}/materials`).then((r) => r.data),
  /** data: { type, title, description, status, publishAt, url, body, durationSeconds }; file opcional. */
  createMaterial: (contentId, data, file, onProgress) =>
    axiosClient.post(`/learning/contents/${contentId}/materials`, body(data, file), config(file, onProgress)).then((r) => r.data),
  updateMaterial: (materialId, data, file, onProgress) =>
    axiosClient.put(`/learning/materials/${materialId}`, body(data, file), config(file, onProgress)).then((r) => r.data),
  deleteMaterial: (materialId) => axiosClient.delete(`/learning/materials/${materialId}`),
  reorder: (contentId, ids) => axiosClient.put(`/learning/contents/${contentId}/materials/order`, { ids }).then((r) => r.data),
  /** Avance por alumno: { material, totals, students: [{ name, section_name, status, viewed_at, completed_at }] } */
  materialProgress: (materialId) => axiosClient.get(`/learning/materials/${materialId}/progress`).then((r) => r.data),
  staffFile: (materialId) => axiosClient.get(`/learning/materials/${materialId}/file`, { responseType: 'blob' }).then((r) => ({ blob: r.data, headers: r.headers })),

  // ---- Familia / modo alumno ----
  /** { section, subjects: [{ id, name, latest, progress }] } */
  studentSubjects: (studentId) => axiosClient.get(`/portal/students/${studentId}/learning`).then((r) => r.data),
  /** { subject, grade, progress, units: [{ name, progress, topics: [{ id, title, week, materials }] }] } */
  studentSubject: (studentId, subjectId) => axiosClient.get(`/portal/students/${studentId}/learning/subjects/${subjectId}`).then((r) => r.data),
  familyFile: (studentId, materialId) =>
    axiosClient.get(`/portal/students/${studentId}/learning/materials/${materialId}/file`, { responseType: 'blob' }).then((r) => ({ blob: r.data, headers: r.headers })),
  markViewed: (studentId, materialId) => axiosClient.post(`/portal/students/${studentId}/learning/materials/${materialId}/view`).then((r) => r.data),
  setCompleted: (studentId, materialId, completed) =>
    axiosClient.put(`/portal/students/${studentId}/learning/materials/${materialId}/complete`, { completed }).then((r) => r.data),
};

export default learningApi;
