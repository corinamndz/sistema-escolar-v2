import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useAuth } from '../../../context/AuthContext';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { REVIEW_STATUSES } from '../../reviews/reviewCatalog';
import { subjectColor, useTeacher } from '../TeacherContext';

const SHORT = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (ymd) => SHORT.format(new Date(`${ymd}T12:00:00`));

// ===========================================================================
// Calificar: bandeja única
// ===========================================================================

/**
 * Todo lo que el docente tiene por calificar, en un solo lugar:
 *   - entregas de tareas en línea esperando nota
 *   - evaluaciones ya aplicadas (fecha pasada) con alumnos sin nota
 */
export function GradeInboxPage() {
  const teacher = useTeacher();
  const navigate = useNavigate();
  // Al entrar, datos frescos (las notas pudieron cargarse en otra pantalla).
  useEffect(() => {
    teacher?.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Fuera del portal docente (p. ej. administrador con ficha docente) no hay clase activa.
  if (!teacher) return <Navigate to="/" replace />;
  if (teacher.loading && !teacher.today) return <Spinner />;
  if (teacher.error) return <Alert>{teacher.error}</Alert>;
  const p = teacher.today?.pending || { to_grade: [], ungraded: [] };
  const openNotes = (e) => {
    const key = `${e.section_id}:${e.subject_id}`;
    if (teacher.classes.some((c) => c.key === key)) teacher.setActive(key);
    navigate(`/docente/clase?tab=notas&plan=${e.plan_id}`);
  };

  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Calificar</h1>
          <p className="family-page-head__sub">Entregas y evaluaciones que esperan tu nota</p>
        </div>
        <Link to="/submissions" className="btn btn--secondary btn--sm">
          Todas las tareas en línea
        </Link>
      </header>

      {!p.to_grade.length && !p.ungraded.length && (
        <div className="fh-empty">
          <span className="fh-empty__icon">🎉</span>
          <div>
            <strong>¡Nada por calificar!</strong>
            <span>Cuando lleguen entregas o pase la fecha de una evaluación, aparecerán aquí.</span>
          </div>
        </div>
      )}

      {p.to_grade.length > 0 && (
        <section className="fh-card fp-section" aria-labelledby="gi-sub">
          <header className="fh-card__head">
            <h2 id="gi-sub" className="fh-card__title">
              Entregas por calificar <span className="nav-badge nav-badge--inline">{p.to_grade.reduce((n, a) => n + a.to_grade, 0)}</span>
            </h2>
          </header>
          <ul className="fp-list">
            {p.to_grade.map((a) => (
              <li key={a.activity_id} className="fp-row">
                <div className="fp-row__main">
                  <span className="fp-row__title">{a.title}</span>
                  <span className="fp-row__meta">
                    {a.subject_name} · {a.grade_name}
                  </span>
                </div>
                <Badge variant="warning">{a.to_grade} por calificar</Badge>
                <Link to={`/submissions/${a.activity_id}`} className="btn btn--primary btn--sm">
                  Calificar
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.ungraded.length > 0 && (
        <section className="fh-card fp-section" aria-labelledby="gi-eval">
          <header className="fh-card__head">
            <h2 id="gi-eval" className="fh-card__title">
              Evaluaciones aplicadas sin nota <span className="nav-badge nav-badge--inline">{p.ungraded.length}</span>
            </h2>
          </header>
          <ul className="fp-list">
            {p.ungraded.map((e) => (
              <li key={`${e.activity_id}-${e.section_id}`} className="fp-row" style={{ '--subject': subjectColor(e.subject_id) }}>
                <div className="fp-row__main">
                  <span className="fp-row__title">
                    <span className="tc-dot" aria-hidden="true" /> {e.title}
                  </span>
                  <span className="fp-row__meta">
                    {e.subject_name} · {e.grade_name} {e.section_name} · aplicada el {day(e.date)}
                  </span>
                </div>
                <Badge variant={e.missing === e.students ? 'warning' : 'info'}>{e.missing === e.students ? 'Sin notas' : `${e.missing} de ${e.students} sin nota`}</Badge>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => openNotes(e)}>
                  Cargar notas
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ===========================================================================
// Planificación
// ===========================================================================

/**
 * Planes de evaluación de las clases del docente (años activos), agrupados por
 * materia, con su estado de revisión y ponderación; y el contenido programático
 * de cada materia y grado.
 */
export function PlanningPage() {
  const teacher = useTeacher();
  const { data, loading, error } = useFetch(() => evaluationPlansApi.list(), []);
  const [filter, setFilter] = useState('');
  const periods = useMemo(() => new Set((teacher?.classes || []).map((c) => c.school_period_id)), [teacher?.classes]);
  const plans = (data || []).filter((p) => periods.has(p.school_period_id));
  const counts = Object.fromEntries(Object.keys(REVIEW_STATUSES).map((k) => [k, plans.filter((p) => p.review_status === k).length]));
  const shown = plans.filter((p) => !filter || p.review_status === filter);
  const bySubject = useMemo(() => {
    const m = new Map();
    shown.forEach((p) => m.set(p.subject_name, [...(m.get(p.subject_name) || []), p]));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [shown]);
  // Contenido programático: una entrada por grado + materia de su carga.
  const contents = useMemo(() => {
    const m = new Map();
    (teacher?.classes || []).forEach((c) => m.set(`${c.grade_id}:${c.subject_id}:${c.school_period_id}`, c));
    return [...m.values()];
  }, [teacher?.classes]);

  // Fuera del portal docente (p. ej. administrador con ficha docente) no hay clase activa.
  if (!teacher) return <Navigate to="/" replace />;
  if (loading || teacher.loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Planificación</h1>
          <p className="family-page-head__sub">Tus planes de evaluación y el contenido programático de tus materias</p>
        </div>
        <Link to="/evaluation-plans" className="btn btn--primary btn--sm">
          <Icon name="plus" size={15} /> Nuevo plan
        </Link>
      </header>

      <div className="agenda-filters" role="group" aria-label="Filtrar por estado">
        <button type="button" className={`agenda-filter ${!filter ? 'is-active' : ''}`} onClick={() => setFilter('')} aria-pressed={!filter}>
          Todos <span>{plans.length}</span>
        </button>
        {Object.entries(REVIEW_STATUSES)
          .filter(([k]) => counts[k] > 0)
          .map(([k, s]) => (
            <button key={k} type="button" className={`agenda-filter ${filter === k ? 'is-active' : ''}`} onClick={() => setFilter(filter === k ? '' : k)} aria-pressed={filter === k}>
              {s.label} <span>{counts[k]}</span>
            </button>
          ))}
      </div>

      {bySubject.length === 0 ? (
        <div className="fh-empty fh-empty--neutral">
          <span className="fh-empty__icon">🗂️</span>
          <div>
            <strong>{plans.length ? 'No hay planes con ese estado' : 'Aún no tienes planes de evaluación'}</strong>
            <span>Crea un plan por materia y período para organizar tus evaluaciones.</span>
          </div>
        </div>
      ) : (
        bySubject.map(([subject, list]) => (
          <section key={subject} className="fh-card fp-section" style={{ '--subject': subjectColor(list[0].subject_id) }}>
            <header className="fh-card__head">
              <h2 className="fh-card__title">
                <span className="tc-dot" aria-hidden="true" /> {subject}
              </h2>
            </header>
            <ul className="fp-list">
              {list.map((p) => {
                const review = REVIEW_STATUSES[p.review_status] || REVIEW_STATUSES.borrador;
                const weight = Math.round(Number(p.total_weight) * 100) / 100;
                return (
                  <li key={p.id} className="fp-row">
                    <div className="fp-row__main">
                      <span className="fp-row__title">
                        {p.grade_name} {p.section_names} · {p.term_name}
                      </span>
                      <span className="fp-row__meta">
                        {p.activity_count} actividades · suma {weight} %
                      </span>
                      <div className="learn-progress__track tc-weight" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weight} aria-label="Ponderación">
                        <div className="learn-progress__fill" style={{ width: `${Math.min(100, weight)}%` }} />
                      </div>
                    </div>
                    <Badge variant={review.variant}>{review.label}</Badge>
                    <Link to={`/evaluation-plans/${p.id}`} className="btn btn--secondary btn--sm">
                      Abrir
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {contents.length > 0 && (
        <section className="fh-card fp-section" aria-labelledby="pl-content">
          <header className="fh-card__head">
            <h2 id="pl-content" className="fh-card__title">
              Contenido programático
            </h2>
          </header>
          <div className="more-grid">
            {contents.map((c) => (
              <Link
                key={`${c.grade_id}:${c.subject_id}:${c.school_period_id}`}
                to={`/programmatic-content?materia=${c.subject_id}&grado=${c.grade_id}&ano=${c.school_period_id}`}
                className="more-tile"
                style={{ '--subject': subjectColor(c.subject_id) }}
              >
                <span className="more-tile__icon tc-tile-icon">
                  <Icon name="layers" size={20} />
                </span>
                <span className="more-tile__text">
                  <span className="more-tile__label">{c.subject_name}</span>
                  <span className="more-tile__hint">
                    {c.grade_name} · {c.school_period_name}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="more-tile__chevron" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ===========================================================================
// Más
// ===========================================================================

export function TeacherMorePage() {
  const { can } = useAuth();
  const groups = [
    {
      title: 'Mi trabajo',
      items: [
        { icon: 'clock', label: 'Mi horario', hint: 'Tus clases de la semana', to: '/schedules/mine' },
        { module: 'students', icon: 'graduation', label: 'Mis alumnos', hint: 'Fichas de los alumnos de tus secciones', to: '/students' },
        { module: 'grading', icon: 'inbox', label: 'Tareas en línea', hint: 'Todas las actividades con entrega digital', to: '/submissions' },
        { module: 'evaluation_plans', icon: 'clipboard', label: 'Planes de evaluación', hint: 'La lista completa, con filtros', to: '/evaluation-plans' },
        { module: 'evaluation_plans', icon: 'layers', label: 'Contenido programático', hint: 'Unidades, temas y material de apoyo', to: '/programmatic-content' },
      ],
    },
    {
      title: 'Comunidad',
      items: [
        { module: 'appointments', icon: 'users', label: 'Citas con padres', hint: 'Citas de tus alumnos', to: '/appointments' },
        { module: 'recognitions', icon: 'award', label: 'Reconocimientos', hint: 'Otorga logros a tus alumnos', to: '/recognitions' },
        { module: 'clubs', icon: 'star', label: 'Clubes', hint: 'Actividades extracurriculares', to: '/clubs' },
        { module: 'events', icon: 'calendar', label: 'Eventos y cartelera', hint: 'Actividades del colegio', to: '/events' },
        { icon: 'bell', label: 'Notificaciones', hint: 'Todos tus avisos', to: '/notifications' },
      ],
    },
  ];
  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">Más</h1>
          <p className="family-page-head__sub">Otras secciones del portal docente</p>
        </div>
      </header>
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.module || can(i.module, 'read'));
        if (!items.length) return null;
        return (
          <section key={g.title} className="more-group">
            <h2 className="more-group__title">{g.title}</h2>
            <div className="more-grid">
              {items.map((i) => (
                <Link key={i.label} to={i.to} className="more-tile">
                  <span className="more-tile__icon">
                    <Icon name={i.icon} size={22} />
                  </span>
                  <span className="more-tile__text">
                    <span className="more-tile__label">{i.label}</span>
                    <span className="more-tile__hint">{i.hint}</span>
                  </span>
                  <Icon name="chevronRight" size={16} className="more-tile__chevron" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
