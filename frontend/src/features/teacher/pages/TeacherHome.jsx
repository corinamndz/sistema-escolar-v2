import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { subjectColor, useTeacher } from '../TeacherContext';
import WelcomeBanner from '../../../components/ui/WelcomeBanner';

/**
 * «Hoy» del docente: un centro de control al iniciar sesión.
 *   Pendientes   entregas por calificar, evaluaciones aplicadas sin nota,
 *                planes observados, planes que no suman 100 % o listos para revisión
 *   Clases de hoy  horario del día con la clase en curso, «Abrir clase» y el
 *                enlace de clase en línea; cuenta regresiva a la siguiente
 *   Accesos rápidos y próximas evaluaciones (7 días)
 */
const SHORT = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (ymd) => SHORT.format(new Date(`${ymd}T12:00:00`));
const WEEKDAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const minutesBetween = (a, b) => {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return bh * 60 + bm - (ah * 60 + am);
};

/** Hora actual "HH:MM" que se actualiza cada minuto (estado de las clases del día). */
function useClock() {
  const [now, setNow] = useState(nowHHMM);
  useEffect(() => {
    const id = setInterval(() => setNow(nowHHMM()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function TeacherHome() {
  const teacher = useTeacher();
  const navigate = useNavigate();
  const clock = useClock();
  const [showAll, setShowAll] = useState(false);

  if (teacher.loading) {
    return (
      <div className="fh" aria-busy="true">
        <WelcomeBanner role="Portal docente" subtitle="Preparando tu día…" />
        <div className="fh-card">
          <div className="fh-skeleton">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton fh-skeleton__row" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (teacher.error) return <Alert>{teacher.error}</Alert>;

  const today = teacher.today;
  const classKey = (s) => `${s.section_id}:${s.subject_id}`;
  const openClass = (key, tab = 'notas', extra = '') => {
    if (key && teacher.classes.some((c) => c.key === key)) teacher.setActive(key);
    navigate(`/docente/clase?tab=${tab}${extra}`);
  };

  // ---- Pendientes, por urgencia ----
  const p = today?.pending || { to_grade: [], ungraded: [], observed: [], incomplete: [], ready: [] };
  const pending = [
    ...p.observed.map((pl) => ({
      key: `obs-${pl.id}`,
      tone: 'late',
      icon: 'alertCircle',
      title: `Plan observado · ${pl.subject_name} ${pl.grade_name} ${pl.section_names || ''}`.trim(),
      text: pl.last_observation ? `«${pl.last_observation.slice(0, 140)}${pl.last_observation.length > 140 ? '…' : ''}»` : 'Coordinación pidió ajustes antes de aprobarlo.',
      action: { label: 'Revisar', to: `/evaluation-plans/${pl.id}?revision=1` },
    })),
    ...p.to_grade.map((a) => ({
      key: `tg-${a.activity_id}`,
      tone: 'soon',
      icon: 'inbox',
      title: `${plural(a.to_grade, 'entrega', 'entregas')} por calificar`,
      text: `${a.title} · ${a.subject_name} · ${a.grade_name}`,
      action: { label: 'Calificar', to: `/submissions/${a.activity_id}` },
    })),
    ...p.ungraded.map((e) => ({
      key: `ug-${e.activity_id}-${e.section_id}`,
      tone: 'soon',
      icon: 'clipboard',
      title: `${e.missing === e.students ? 'Sin notas' : `${e.missing} de ${e.students} sin nota`} · ${e.title}`,
      text: `${e.subject_name} · ${e.grade_name} ${e.section_name} · aplicada el ${day(e.date)}`,
      onClick: () => openClass(`${e.section_id}:${e.subject_id}`, 'notas', `&plan=${e.plan_id}`),
      actionLabel: 'Cargar notas',
    })),
    ...p.incomplete.map((pl) => ({
      key: `inc-${pl.id}`,
      tone: 'neutral',
      icon: 'clipboard',
      title: `Plan incompleto · ${pl.subject_name} ${pl.grade_name}`,
      text: `Suma ${Math.round(pl.total_weight * 100) / 100} % de 100 % · ${pl.term_name}`,
      action: { label: 'Completar', to: `/evaluation-plans/${pl.id}` },
    })),
    ...p.ready.map((pl) => ({
      key: `rdy-${pl.id}`,
      tone: 'info',
      icon: 'send',
      title: `Listo para revisión · ${pl.subject_name} ${pl.grade_name}`,
      text: 'Suma 100 %: envíalo a coordinación para publicarlo a las familias.',
      action: { label: 'Enviar', to: `/evaluation-plans/${pl.id}?revision=1` },
    })),
  ];
  const shownPending = showAll ? pending : pending.slice(0, 5);

  // ---- Clases de hoy ----
  const weekday = today?.today.weekday;
  const todays = (today?.schedule || []).filter((s) => s.day_of_week === weekday);
  const nextDay = !todays.length
    ? [...new Set((today?.schedule || []).map((s) => s.day_of_week))].sort((a, b) => ((a - weekday + 7) % 7) - ((b - weekday + 7) % 7)).find((d) => d !== weekday)
    : null;
  const nextDayClasses = nextDay ? today.schedule.filter((s) => s.day_of_week === nextDay) : [];
  const stateOf = (s) => (clock >= s.end_time ? 'done' : clock >= s.start_time ? 'now' : 'next');
  const upcomingClass = todays.find((s) => stateOf(s) === 'next');
  const remaining = todays.filter((s) => stateOf(s) !== 'done').length;

  const status = pending.length
    ? `Tienes ${plural(pending.length, 'pendiente', 'pendientes')}${todays.length ? ` y ${plural(remaining, 'clase', 'clases')} por delante hoy` : ''}.`
    : todays.length
      ? `Sin pendientes. ${remaining ? `Te quedan ${plural(remaining, 'clase', 'clases')} hoy.` : 'Terminaste tus clases de hoy.'}`
      : 'Sin pendientes por ahora. ✓';

  return (
    <div className="fh th">
      {/* Banda de bienvenida protegida (DESIGN_SYSTEM.md): igual en los tres portales. */}
      <WelcomeBanner role="Portal docente" subtitle={status} />

      <div className="fh-grid">
        <div className="fh-main">
          {/* Pendientes */}
          <section className="fh-card" aria-labelledby="th-pending">
            <header className="fh-card__head">
              <h2 id="th-pending" className="fh-card__title">
                Pendientes {pending.length > 0 && <span className="nav-badge nav-badge--inline">{pending.length}</span>}
              </h2>
              <Link to="/docente/calificar" className="fh-card__more">
                Calificar <Icon name="chevronRight" size={14} />
              </Link>
            </header>
            {pending.length === 0 ? (
              <div className="fh-empty">
                <span className="fh-empty__icon">🎉</span>
                <div>
                  <strong>¡Todo al día!</strong>
                  <span>No tienes entregas ni evaluaciones por calificar, ni planes por ajustar.</span>
                </div>
              </div>
            ) : (
              <>
                <ul className="th-pending">
                  {shownPending.map((it) => (
                    <li key={it.key} className={`th-pending__item th-pending__item--${it.tone}`}>
                      <span className="th-pending__icon">
                        <Icon name={it.icon} size={18} />
                      </span>
                      <span className="th-pending__body">
                        <strong>{it.title}</strong>
                        <span>{it.text}</span>
                      </span>
                      {it.action ? (
                        <Link to={it.action.to} className="btn btn--secondary btn--sm">
                          {it.action.label}
                        </Link>
                      ) : (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={it.onClick}>
                          {it.actionLabel}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {pending.length > 5 && (
                  <button type="button" className="fh-link-btn fh-pending__more" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Ver menos' : `Ver ${pending.length - 5} más`}
                  </button>
                )}
              </>
            )}
          </section>

          {/* Clases de hoy */}
          <section className="fh-card" aria-labelledby="th-today">
            <header className="fh-card__head">
              <h2 id="th-today" className="fh-card__title">
                Clases de hoy
              </h2>
              <Link to="/schedules/mine" className="fh-card__more">
                Mi horario <Icon name="chevronRight" size={14} />
              </Link>
            </header>
            {todays.length === 0 ? (
              <div className="fh-empty fh-empty--neutral">
                <span className="fh-empty__icon">☕</span>
                <div>
                  <strong>Hoy no tienes clases en el horario</strong>
                  <span>
                    {nextDayClasses.length
                      ? `Tu próximo día de clases es el ${WEEKDAYS[nextDay]}: ${plural(nextDayClasses.length, 'clase', 'clases')}, desde las ${nextDayClasses[0].start_time}.`
                      : 'Cuando la coordinación publique tu horario, aparecerá aquí.'}
                  </span>
                </div>
              </div>
            ) : (
              <>
                {upcomingClass && (
                  <p className="th-next">
                    <Icon name="clock" size={15} /> Siguiente: <strong>{upcomingClass.subject_name}</strong> con {upcomingClass.grade_name} {upcomingClass.section_name}{' '}
                    {minutesBetween(clock, upcomingClass.start_time) <= 90 ? `en ${minutesBetween(clock, upcomingClass.start_time)} min` : `a las ${upcomingClass.start_time}`}
                  </p>
                )}
                <ol className="th-classes">
                  {todays.map((s) => {
                    const st = stateOf(s);
                    return (
                      <li key={s.id} className={`th-class th-class--${st}`} style={{ '--subject': subjectColor(s.subject_id) }}>
                        <span className="th-class__time">
                          <strong>{s.start_time}</strong>
                          <span>{s.end_time}</span>
                        </span>
                        <span className="th-class__body">
                          <strong>
                            {s.subject_name} {st === 'now' && <span className="class-switcher__now">Ahora</span>}
                            {st === 'done' && <Icon name="check" size={14} className="th-class__done" />}
                          </strong>
                          <span>
                            {s.grade_name} · Sección {s.section_name}
                            {s.classroom_name ? ` · ${s.classroom_name}` : ''}
                          </span>
                        </span>
                        <span className="th-class__actions">
                          {s.link && st !== 'done' && (
                            <a className="btn btn--primary btn--sm" href={s.link} target="_blank" rel="noopener noreferrer">
                              <Icon name="video" size={14} /> Entrar
                            </a>
                          )}
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => openClass(classKey(s))}>
                            Abrir clase
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>
        </div>

        <aside className="fh-side">
          <nav className="fh-quick th-quick" aria-label="Accesos rápidos">
            {[
              { key: 'grades', icon: 'trendingUp', label: 'Cargar notas', onClick: () => openClass(null, 'notas') },
              { key: 'inbox', icon: 'inbox', label: 'Entregas', to: '/docente/calificar', badge: p.to_grade.reduce((n, a) => n + a.to_grade, 0) },
              { key: 'material', icon: 'book', label: 'Subir material', onClick: () => openClass(null, 'material') },
              { key: 'plans', icon: 'clipboard', label: 'Mis planes', to: '/docente/planificacion' },
            ].map((q) =>
              q.to ? (
                <Link key={q.key} to={q.to} className="fh-quick__btn">
                  <span className="fh-quick__icon">
                    <Icon name={q.icon} size={22} />
                    {q.badge > 0 && <span className="nav-badge">{q.badge > 9 ? '9+' : q.badge}</span>}
                  </span>
                  <span className="fh-quick__label">{q.label}</span>
                </Link>
              ) : (
                <button key={q.key} type="button" className="fh-quick__btn" onClick={q.onClick}>
                  <span className="fh-quick__icon">
                    <Icon name={q.icon} size={22} />
                  </span>
                  <span className="fh-quick__label">{q.label}</span>
                </button>
              )
            )}
          </nav>

          <section className="fh-card" aria-labelledby="th-upcoming">
            <header className="fh-card__head">
              <h2 id="th-upcoming" className="fh-card__title">
                Próximas evaluaciones
              </h2>
            </header>
            {!today?.upcoming?.length ? (
              <p className="home-muted">No hay evaluaciones en los próximos 7 días.</p>
            ) : (
              <ul className="th-upcoming">
                {today.upcoming.slice(0, 6).map((e) => (
                  <li key={`${e.activity_id}-${e.section_id}`}>
                    <button type="button" className="th-upcoming__item" onClick={() => openClass(`${e.section_id}:${e.subject_id}`, 'plan')}>
                      <span className="th-upcoming__date">{day(e.date)}</span>
                      <span>
                        <strong>{e.title}</strong>
                        <span>
                          {e.subject_name} · {e.grade_name} {e.section_name}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default TeacherHome;
