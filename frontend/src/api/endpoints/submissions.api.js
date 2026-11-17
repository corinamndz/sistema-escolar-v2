import { axiosClient } from '../axiosClient';

/** Bandeja de calificación de entregas (aula virtual). La familia entrega desde portal.api. */
const submissionsApi = {
  /** Actividades con entrega digital de mi carga (años activos), con sus contadores. */
  getInbox: () => axiosClient.get('/submissions/inbox').then((r) => r.data),
  /** { activity, sections, students: [{ student_id, name, section, status, submission, score }], totals } */
  getActivity: (activityId, params) => axiosClient.get(`/submissions/activities/${activityId}`, { params }).then((r) => r.data),
  /** Archivo entregado por el alumno: { blob, headers }. */
  downloadFile: (activityId, studentId) =>
    axiosClient.get(`/submissions/activities/${activityId}/students/${studentId}/file`, { responseType: 'blob' }).then((r) => ({ blob: r.data, headers: r.headers })),
  /** { grade? | literal?, feedback? } → fila del alumno actualizada. Con indicadores: solo { feedback }. */
  grade: (activityId, studentId, body) => axiosClient.put(`/submissions/activities/${activityId}/students/${studentId}/grade`, body).then((r) => r.data),
  /** Devolver para corregir: { feedback } (obligatorio). */
  returnForFix: (activityId, studentId, body) => axiosClient.post(`/submissions/activities/${activityId}/students/${studentId}/return`, body).then((r) => r.data),
};

export default submissionsApi;
