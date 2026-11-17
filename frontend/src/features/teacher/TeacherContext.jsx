import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import teacherApi from '../../api/endpoints/teacher.api';
import { getErrorMessage } from '../../api/axiosClient';

/**
 * Portal del docente: sus CLASES (sección + materia) y la CLASE ACTIVA, que
 * comparten Mis clases, Planificación y el selector de la barra superior. La
 * clase elegida y las recientes se recuerdan en el dispositivo. También carga
 * el panel «Hoy» (pendientes y horario) para el inicio, las insignias y la
 * clase "en curso" del selector.
 *
 *   const { classes, active, setActive, recent, today, nowClassKey, refetch } = useTeacher();
 */
const TeacherContext = createContext(null);
const ACTIVE_KEY = 'teacher.activeClass';
const RECENT_KEY = 'teacher.recentClasses';

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin almacenamiento: solo no se recuerda
  }
};

/** Color estable por materia (mismo tono en selector, horario y tarjetas). */
const PALETTE = ['#2563eb', '#7c3aed', '#047857', '#be185d', '#b45309', '#0e7490', '#4338ca', '#a21caf'];
export function subjectColor(subjectId) {
  let h = 0;
  for (const ch of String(subjectId || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const classLabel = (c) => (c ? `${c.grade_name} ${c.section_name} · ${c.subject_name}` : '');

/** Clase en curso (o la siguiente de hoy) según el horario. */
function currentFromSchedule(today) {
  if (!today) return null;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const list = today.schedule.filter((s) => s.day_of_week === today.today.weekday);
  return list.find((s) => s.start_time <= hhmm && hhmm < s.end_time) || null;
}

export function TeacherProvider({ children }) {
  const [state, setState] = useState({ classes: [], today: null, loading: true, error: null });
  const [activeKey, setActiveKey] = useState(() => read(ACTIVE_KEY, null));
  const [recent, setRecent] = useState(() => read(RECENT_KEY, []));

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([teacherApi.classes(), teacherApi.today().catch(() => null)])
      .then(([classes, today]) => setState({ classes, today, loading: false, error: null }))
      .catch((err) => setState({ classes: [], today: null, loading: false, error: getErrorMessage(err) }));
  }, []);
  useEffect(load, [load]);

  const setActive = useCallback((key) => {
    setActiveKey(key);
    write(ACTIVE_KEY, key);
    setRecent((r) => {
      const next = [key, ...r.filter((k) => k !== key)].slice(0, 4);
      write(RECENT_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const { classes, today } = state;
    const now = currentFromSchedule(today);
    const nowClassKey = now ? `${now.section_id}:${now.subject_id}` : null;
    // Clase activa: la elegida si sigue en la carga; si no, la que está en curso; si no, la primera.
    const active = classes.find((c) => c.key === activeKey) || classes.find((c) => c.key === nowClassKey) || classes[0] || null;
    const pending = today?.pending;
    const pendingCount = pending ? pending.to_grade.length + pending.ungraded.length + pending.observed.length + pending.incomplete.length : 0;
    const toGradeCount = pending ? pending.to_grade.reduce((n, a) => n + a.to_grade, 0) + pending.ungraded.length : 0;
    return { ...state, active, setActive, recent, nowClassKey, pendingCount, toGradeCount, refetch: load };
  }, [state, activeKey, setActive, recent, load]);

  return <TeacherContext.Provider value={value}>{children}</TeacherContext.Provider>;
}

/** Datos del docente (null fuera de su portal). */
export function useTeacher() {
  return useContext(TeacherContext);
}
