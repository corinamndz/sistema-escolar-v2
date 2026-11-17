import { axiosClient } from '../axiosClient';

/** Portal del docente: sus clases (sección + materia), el panel «Hoy» y el enlace de clase en línea. */
const teacherApi = {
  /** [{ key, section_id, section_name, grade_id, grade_name, level_code, grading_scale, school_period_id, school_period_name, subject_id, subject_name, link }] */
  classes: () => axiosClient.get('/teacher/classes').then((r) => r.data),
  /** { today: { date, weekday }, schedule: [...], pending: { to_grade, ungraded, observed, incomplete, ready }, upcoming: [...] } */
  today: () => axiosClient.get('/teacher/today').then((r) => r.data),
  sectionStudents: (sectionId) => axiosClient.get(`/teacher/sections/${sectionId}/students`).then((r) => r.data),
  /** { url, label } o { url: null } para quitarlo. */
  setLink: (sectionId, subjectId, body) => axiosClient.put(`/teacher/classes/${sectionId}/${subjectId}/link`, body).then((r) => r.data),
};

export default teacherApi;
