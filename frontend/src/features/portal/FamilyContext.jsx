import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import portalApi from '../../api/endpoints/portal.api';
import { getErrorMessage } from '../../api/axiosClient';

/**
 * Portal del representante: datos de la familia (/portal/me) cargados UNA vez
 * y el HIJO ACTIVO, compartido por todas las pantallas (Inicio, Académico,
 * Agenda, Más). El hijo elegido se recuerda en este dispositivo, así el padre
 * no vuelve a elegirlo en cada pantalla.
 *
 *   const { students, student, setStudentId, data, refetch } = useFamily();
 */
const FamilyContext = createContext(null);
const STORAGE_KEY = 'portal.activeStudent';

/** Un color fijo por hijo (selector, avatar y chips): el padre reconoce de quién es algo sin leer. */
const CHILD_COLORS = ['#2563eb', '#7c3aed', '#047857', '#be185d', '#b45309', '#0e7490'];

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function FamilyProvider({ children }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [studentId, setStudentIdState] = useState(readStored);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    portalApi
      .getMine()
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => setState({ data: null, loading: false, error: getErrorMessage(err) }));
  }, []);
  useEffect(load, [load]);

  const setStudentId = useCallback((id) => {
    setStudentIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // sin almacenamiento: solo no se recuerda
    }
  }, []);

  const value = useMemo(() => {
    const students = state.data?.students || [];
    // Primero los que tienen inscripción activa; el elegido si sigue vinculado.
    const enrolled = students.filter((s) => s.section_id);
    const student = students.find((s) => s.id === studentId) || enrolled[0] || students[0] || null;
    // Orden estable (por id) para que cada hijo conserve su color aunque cambie el orden de la lista.
    const order = [...students].map((s) => s.id).sort();
    const colorOf = (id) => CHILD_COLORS[Math.max(0, order.indexOf(id)) % CHILD_COLORS.length];
    return { ...state, students, student, setStudentId, refetch: load, colorOf };
  }, [state, studentId, setStudentId, load]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

/** Datos de la familia y el hijo activo (null fuera del portal del representante). */
export function useFamily() {
  return useContext(FamilyContext);
}
