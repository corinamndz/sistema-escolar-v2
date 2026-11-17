import { useEffect, useMemo, useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import appointmentsApi from '../../../api/endpoints/appointments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { usePortalViews } from '../../../lib/portalViews';
import { useFamily } from '../FamilyContext';
import { deadlineSignal } from '../../submissions/submissionStatus';
import { AGENDA_KINDS, AgendaItem } from '../components/agenda/AgendaItem';
import AgendaCalendar from '../components/agenda/AgendaCalendar';

/**
 * Agenda de la familia: en UNA lista por día, lo que viene para el hijo activo
 * (evaluaciones y entregas de tareas) y para la familia (eventos del colegio y
 * citas). Filtros por tipo; "Próximos" (60 días) o "Anteriores" (30 días).
 * Cada ítem lleva directo a su detalle o acción (confirmar la cita aquí mismo).
 *
 * Dos vistas (se recuerda la última): LISTA por día o CALENDARIO (mes/semana).
 * Las dos usan los mismos filtros: hijo activo (selector global) y tipo.
 */
const KINDS = AGENDA_KINDS;
const VIEW_KEY = 'portal.agendaView';
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
};

const pad = (n) => String(n).padStart(2, '0');
const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
};
const DAY = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const TIME = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });

function dayLabel(ymd, today) {
  if (ymd === today) return 'Hoy';
  if (ymd === addDays(today, 1)) return 'Mañana';
  if (ymd === addDays(today, -1)) return 'Ayer';
  const text = DAY.format(new Date(`${ymd}T12:00:00`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Carga en paralelo lo que el colegio tiene activo; lo que falle no tumba la agenda. */
function useAgendaData(studentId, isOn) {
  const [state, setState] = useState({ loading: true, items: [], errors: [], reload: 0 });
  useEffect(() => {
    if (!studentId) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const sources = [
      isOn('evaluations') && portalApi.getStudentEvaluations(studentId).then((d) => mapEvaluations(d)),
      isOn('tasks') && portalApi.getStudentTasks(studentId).then((d) => mapTasks(d.tasks)),
      isOn('events') && portalApi.getEvents().then((d) => mapEvents(d)),
      isOn('appointments') && appointmentsApi.mine().then((d) => mapAppointments(d)),
    ].filter(Boolean);
    Promise.allSettled(sources).then((results) => {
      if (cancelled) return;
      setState((s) => ({
        ...s,
        loading: false,
        items: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
        errors: results.filter((r) => r.status === 'rejected').map((r) => getErrorMessage(r.reason)),
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, state.reload]);
  return { ...state, reload: () => setState((s) => ({ ...s, reload: s.reload + 1 })) };
}

function mapEvaluations(cal) {
  return (cal.evaluations || [])
    .filter((e) => e.date)
    .map((e) => ({
      id: `ev-${e.activity_id}`,
      kind: 'evaluation',
      date: e.date,
      time: e.start_time || null,
      title: e.title,
      detail: `${e.subject_name} · ${e.category_label}${e.heavy ? ' · ponderación alta' : ''}`,
      to: '/portal/academico?tab=tareas&sub=evaluaciones',
      done: e.student_graded,
    }));
}

function mapTasks(tasks) {
  return tasks.map((t) => {
    const deadline = new Date(t.deadline);
    const pending = t.status === 'pending';
    return {
      id: `tk-${t.id}`,
      kind: 'task',
      date: ymdLocal(deadline),
      time: TIME.format(deadline),
      title: `Entrega: ${t.title}`,
      detail: t.subject,
      to: '/portal/academico?tab=tareas&sub=entregas',
      done: !pending,
      signal: pending ? deadlineSignal(t.deadline) : null,
    };
  });
}

function mapEvents(events) {
  return (events || []).map((e) => ({
    id: `evt-${e.id}`,
    kind: 'event',
    date: String(e.event_date).slice(0, 10),
    time: e.start_time ? (e.end_time ? `${e.start_time} – ${e.end_time}` : e.start_time) : null,
    title: e.title,
    detail: e.location || 'Evento del colegio',
    to: '/portal/events',
  }));
}

function mapAppointments(list) {
  return (list || []).map((a) => ({
    id: `ap-${a.id}`,
    kind: 'appointment',
    date: a.meeting_date,
    time: a.end_time ? `${a.start_time} – ${a.end_time}` : a.start_time,
    title: `Cita: ${a.topic}`,
    detail: [a.student_name && `Sobre ${a.student_name}`, a.location].filter(Boolean).join(' · '),
    appointment: a,
  }));
}

function AgendaPage() {
  const family = useFamily();
  const isOn = usePortalViews();
  const toast = useToast();
  const [range, setRange] = useState('next'); // next | past
  const [kind, setKind] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // sin almacenamiento: solo no se recuerda
    }
  };
  const student = family?.student;
  const { loading, items, errors, reload } = useAgendaData(student?.id, isOn);

  const today = ymdLocal(new Date());
  // La lista usa el rango (Próximos / Anteriores); el calendario, todo lo cargado (se navega por mes).
  const inRange = useMemo(
    () =>
      view === 'calendar'
        ? items
        : items.filter((i) => (range === 'next' ? i.date >= today && i.date <= addDays(today, 60) : i.date < today && i.date >= addDays(today, -30))),
    [items, range, today, view]
  );
  const visible = inRange.filter((i) => !kind || i.kind === kind);
  const days = useMemo(() => {
    const map = new Map();
    [...visible]
      .sort((a, b) => (range === 'next' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || String(a.time || '').localeCompare(String(b.time || '')))
      .forEach((i) => map.set(i.date, [...(map.get(i.date) || []), i]));
    return [...map.entries()];
  }, [visible, range]);

  if (family.loading) return <Spinner />;
  if (family.error) return <Alert>{family.error}</Alert>;
  if (!student) return <Alert variant="info">Aún no tienes alumnos vinculados a tu cuenta.</Alert>;

  const confirm = async (a) => {
    setConfirming(a.id);
    try {
      await appointmentsApi.confirmMine(a.id);
      toast.success('Asistencia confirmada', a.topic);
      reload();
    } catch (err) {
      toast.error('No se pudo confirmar', getErrorMessage(err));
    } finally {
      setConfirming(null);
    }
  };

  const counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, inRange.filter((i) => i.kind === k).length]));

  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Agenda</h1>
          <p className="family-page-head__sub">Evaluaciones y entregas de {student.first_name}, eventos del colegio y tus citas</p>
        </div>
        <div className="agenda-toolbar">
          {view === 'list' && (
            <div className="segmented" role="tablist" aria-label="Rango">
              <button type="button" role="tab" aria-selected={range === 'next'} className={`segmented__item ${range === 'next' ? 'segmented__item--active' : ''}`} onClick={() => setRange('next')}>
                Próximos
              </button>
              <button type="button" role="tab" aria-selected={range === 'past'} className={`segmented__item ${range === 'past' ? 'segmented__item--active' : ''}`} onClick={() => setRange('past')}>
                Anteriores
              </button>
            </div>
          )}
          <div className="segmented agenda-viewtoggle" role="tablist" aria-label="Vista">
            <button type="button" role="tab" aria-selected={view === 'list'} className={`segmented__item ${view === 'list' ? 'segmented__item--active' : ''}`} onClick={() => setView('list')}>
              <Icon name="listBullet" size={15} /> Lista
            </button>
            <button type="button" role="tab" aria-selected={view === 'calendar'} className={`segmented__item ${view === 'calendar' ? 'segmented__item--active' : ''}`} onClick={() => setView('calendar')}>
              <Icon name="calendar" size={15} /> Calendario
            </button>
          </div>
        </div>
      </header>

      <div className="agenda-filters" role="group" aria-label="Filtrar por tipo">
        <button type="button" className={`agenda-filter ${!kind ? 'is-active' : ''}`} onClick={() => setKind('')} aria-pressed={!kind}>
          Todo <span>{inRange.length}</span>
        </button>
        {Object.entries(KINDS)
          .filter(([k]) => counts[k] > 0)
          .map(([k, meta]) => (
            <button key={k} type="button" className={`agenda-filter agenda-tone--${meta.tone} ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(kind === k ? '' : k)} aria-pressed={kind === k}>
              <Icon name={meta.icon} size={14} /> {meta.label} <span>{counts[k]}</span>
            </button>
          ))}
      </div>

      {errors.length > 0 && <Alert variant="warning">Parte de la agenda no se pudo cargar. Intenta de nuevo en unos minutos.</Alert>}
      {loading ? (
        <Spinner />
      ) : view === 'calendar' ? (
        <AgendaCalendar items={visible} today={today} onConfirm={confirm} confirming={confirming} />
      ) : days.length === 0 ? (
        <div className="learn-empty">
          <Icon name="calendar" size={30} />
          <p>{range === 'next' ? 'No hay nada programado en los próximos 60 días.' : 'No hubo actividades en los últimos 30 días.'}</p>
        </div>
      ) : (
        <div className="agenda">
          {days.map(([date, list]) => (
            <section key={date} className={`agenda-day ${date === today ? 'is-today' : ''}`}>
              <h2 className="agenda-day__title">{dayLabel(date, today)}</h2>
              <ul className="agenda-day__list">
                {list.map((i) => (
                  <AgendaItem key={i.id} item={i} onConfirm={confirm} confirming={confirming} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgendaPage;
