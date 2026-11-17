import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import appointmentsApi from '../../../api/endpoints/appointments.api';
import notificationsApi from '../../../api/endpoints/notifications.api';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { usePortalViews } from '../../../lib/portalViews';
import { NOTIFICATION_ICONS } from '../../../components/layout/NotificationBell';
import { formatAmounts } from '../../payments/paymentStatus';
import { deadlineSignal, formatDateTime } from '../../submissions/submissionStatus';
import { literalFor } from '../../grading/gradingScale';
import { useFamily } from '../FamilyContext';
import WelcomeBanner from '../../../components/ui/WelcomeBanner';

/**
 * Inicio del portal de familia en WIDGETS, del pulgar hacia abajo:
 *   1. Encabezado      saludo + estado en UNA línea
 *   2. Accesos rápidos Pagar · Notas · Hoy · Subir tarea (con contador)
 *   3. Pendientes      UNA tarjeta plegable (solo si hay algo): lo más urgente
 *                      a la vista, el resto plegado; lo no bloqueante se pospone
 *   4. Esta semana     del hijo activo, con semáforo
 *   5. Cómo va         resumen académico del hijo activo (período en curso)
 *   6. Novedades       del hijo activo + avisos de familia, 3 líneas
 *   7. Pagos (mini)    una línea
 *
 * El selector de hijo (arriba) filtra lo que es DE UN HIJO; lo de la FAMILIA
 * (pagos, citas, inscripción) se ve siempre, con el chip del hijo si aplica.
 */
const pad = (n) => String(n).padStart(2, '0');
const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const SHORT_DAY = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDay = (ymd) => SHORT_DAY.format(new Date(`${ymd}T12:00:00`));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- Preferencias de este dispositivo (posponer y plegar) ----
const SNOOZE_KEY = 'portal.home.snoozed';
const FOLD_KEY = 'portal.home.pendingFolded';
const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin almacenamiento: solo no se recuerda
  }
};

/** Datos del inicio del hijo activo + familia, en paralelo (lo que falle no aparece). */
function useHomeData(student, isOn) {
  const [state, setState] = useState({ loading: true, tasks: [], evaluations: [], grades: null, appointments: [], news: [], reminders: [], reload: 0 });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const safe = (p) => p.catch(() => null);
    const locked = Boolean(student?.grades_locked);
    Promise.all([
      student && isOn('tasks') ? safe(portalApi.getStudentTasks(student.id)) : null,
      student && isOn('evaluations') && !locked ? safe(portalApi.getStudentEvaluations(student.id)) : null,
      student?.section_id && isOn('grades') && !locked ? safe(portalApi.getStudentGrades(student.id)) : null,
      isOn('appointments') ? safe(appointmentsApi.mine()) : null,
      safe(notificationsApi.list()),
      safe(enrollmentFormsApi.portalReminders()),
    ]).then(([tasks, evals, grades, appointments, notes, reminders]) => {
      if (cancelled) return;
      setState((s) => ({
        ...s,
        loading: false,
        tasks: tasks?.tasks || [],
        evaluations: evals?.evaluations || [],
        grades,
        appointments: appointments || [],
        news: (notes?.items || []).filter((n) => !n.read),
        reminders: reminders || [],
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, state.reload]);
  return { ...state, reload: () => setState((s) => ({ ...s, reload: s.reload + 1 })) };
}

/**
 * Resumen académico del período en curso (el último con notas; si no hay, el
 * primero con planes): promedio de lo evaluado, materias bien / con apoyo.
 */
function summarizeGrades(grades) {
  if (!grades?.subjects?.length) return null;
  const passing = Number(grades.passing_grade) || 10;
  const terms = grades.terms || [];
  const plansOf = (termId) => grades.subjects.map((s) => ({ subject: s, plan: s.plans.find((p) => p.term_id === termId) })).filter((x) => x.plan);
  const withGrades = [...terms].reverse().find((t) => plansOf(t.id).some((x) => x.plan.graded_count > 0));
  const term = withGrades || terms.find((t) => plansOf(t.id).length);
  if (!term) return null;
  const rows = plansOf(term.id);
  const graded = rows.filter((x) => x.plan.current_average !== null && x.plan.current_average !== undefined);
  const avg = graded.length ? graded.reduce((n, x) => n + Number(x.plan.current_average), 0) / graded.length : null;
  return {
    term: term.name,
    qualitative: grades.grading_scale === 'qualitative',
    average: avg,
    graded: graded.length,
    subjects: rows.length,
    good: graded.filter((x) => Number(x.plan.current_average) >= passing).length,
    support: graded.filter((x) => Number(x.plan.current_average) < passing).map((x) => x.subject.name),
  };
}

function FamilyHome() {
  const { user } = useAuth();
  const family = useFamily();
  const isOn = usePortalViews();
  const student = family?.student;
  const home = useHomeData(student, isOn);

  if (family.loading) return <HomeSkeleton />;
  if (family.error) return <Alert>{family.error}</Alert>;

  return <HomeContent user={user} family={family} student={student} home={home} isOn={isOn} />;
}

function HomeContent({ user, family, student, home, isOn }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(null);
  const [snoozed, setSnoozed] = useState(() => readJson(SNOOZE_KEY, {}));
  const { data, students, colorOf } = family;
  const totals = data?.totals || { pending_count: 0, overdue_count: 0, pending_amounts: [] };
  const showPayments = isOn('payments');
  const today = ymdLocal(new Date());
  const inAWeek = ymdLocal(new Date(Date.now() + 7 * 86_400_000));
  const nameOf = (id) => students.find((s) => s.id === id)?.first_name;
  const now = Date.now();

  // ---- Pendientes (por prioridad: 1 bloquea, 2 importante, 3 puede esperar) ----
  const pending = [];
  if (showPayments && totals.overdue_count > 0) {
    const locked = students.filter((s) => s.grades_locked).map((s) => s.first_name);
    pending.push({
      key: 'overdue',
      level: 1,
      icon: 'receipt',
      title: totals.overdue_count === 1 ? 'Tienes 1 cuota vencida' : `Tienes ${totals.overdue_count} cuotas vencidas`,
      text: [formatAmounts(totals.pending_amounts), locked.length ? `Las notas de ${locked.join(' y ')} están en pausa hasta ponerte al día` : null].filter(Boolean).join(' · '),
      action: { label: 'Ponerme al día', to: '/payments/mine?pagar=vencidas' },
    });
  }
  home.appointments
    .filter((a) => a.status === 'pending')
    .forEach((a) =>
      pending.push({
        key: `ap-${a.id}`,
        level: 2,
        icon: 'users',
        title: 'Cita por confirmar',
        text: `${a.topic} · ${shortDay(a.meeting_date)}, ${a.start_time}`,
        child: a.student_id,
        confirm: a,
      })
    );
  home.tasks
    .filter((t) => t.status === 'pending' && t.submission?.has_file)
    .forEach((t) =>
      pending.push({
        key: `rt-${t.id}`,
        level: 2,
        icon: 'refresh',
        title: 'Tarea devuelta para corregir',
        text: `${t.title} · ${t.subject}`,
        child: student?.id,
        action: { label: 'Ver comentario', to: '/portal/academico?tab=tareas&sub=entregas' },
      })
    );
  const enrollment = home.reminders.filter((r, i, all) => all.findIndex((x) => x.student_id === r.student_id && x.school_period_id === r.school_period_id) === i);
  const enrollTodo = enrollment.filter((r) => r.state === 'missing' || r.state === 'changes_requested');
  const enrollRejected = enrollment.filter((r) => r.state === 'rejected');
  if (enrollTodo.length) {
    pending.push({
      key: `enroll-${enrollTodo.map((r) => `${r.student_id}:${r.state}`).join(',')}`,
      level: 3,
      icon: 'clipboard',
      title: `Inscripción ${[...new Set(enrollTodo.map((r) => r.school_period_name))].join(' y ')}`,
      text: `Falta la planilla de ${enrollTodo.map((r) => r.student_name.split(' ')[0]).join(' y ')} para activar la inscripción oficial.`,
      action: { label: 'Completar planilla', to: '/portal/enrollment' },
      snoozable: true,
    });
  }
  if (enrollRejected.length) {
    pending.push({ key: 'enroll-rejected', level: 2, icon: 'alertCircle', title: 'Planilla de inscripción rechazada', text: 'Comunícate con el colegio para revisarla.' });
  }
  if (showPayments && (data?.billing_issues || []).length > 0) {
    pending.push({ key: 'billing', level: 3, icon: 'info', title: 'Estado de cuenta incompleto', text: 'Algunas mensualidades aún no están cargadas.', snoozable: true });
  }
  const visiblePending = pending.filter((p) => !(p.snoozable && snoozed[p.key] && snoozed[p.key] > now)).sort((a, b) => a.level - b.level);
  const snooze = (key) => {
    const next = { ...snoozed, [key]: now + 20 * 3_600_000 };
    setSnoozed(next);
    writeJson(SNOOZE_KEY, next);
  };

  // ---- Esta semana (hijo activo) ----
  const week = [
    ...home.tasks
      .filter((t) => t.status === 'pending' && !t.submission?.has_file && ymdLocal(new Date(t.deadline)) <= inAWeek)
      .map((t) => ({ key: `t-${t.id}`, kind: 'task', date: ymdLocal(new Date(t.deadline)), sort: t.deadline, title: t.title, detail: `${t.subject} · entrega ${formatDateTime(t.deadline)}`, signal: deadlineSignal(t.deadline) })),
    ...home.evaluations
      .filter((e) => e.date && e.date >= today && e.date <= inAWeek)
      .map((e) => ({ key: `e-${e.activity_id}`, kind: 'evaluation', date: e.date, sort: `${e.date}T${e.start_time || '00:00'}`, title: e.title, detail: `${e.subject_name} · ${e.date === today ? 'hoy' : shortDay(e.date)}`, heavy: e.heavy })),
  ].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
  const todayCount = week.filter((w) => w.date <= today).length;
  const tasksToUpload = home.tasks.filter((t) => t.status === 'pending' && t.can_submit).length;

  // ---- Novedades: del hijo activo o de toda la familia ----
  const news = home.news.filter((n) => !n.data?.student_id || n.data.student_id === student?.id).slice(0, 3);
  const progress = useMemo(() => summarizeGrades(home.grades), [home.grades]);

  const confirm = async (a) => {
    setConfirming(a.id);
    try {
      await appointmentsApi.confirmMine(a.id);
      toast.success('¡Listo! Asistencia confirmada', a.topic);
      home.reload();
    } catch (err) {
      toast.error('No se pudo confirmar', getErrorMessage(err));
    } finally {
      setConfirming(null);
    }
  };
  const openNews = (n) => {
    notificationsApi.markRead(n.id).catch(() => {});
    navigate(n.data?.links?.guardians || n.link || '/notifications');
  };

  // ---- Estado en una línea ----
  const urgent = visiblePending.filter((p) => p.level <= 2).length;
  const status = urgent
    ? `Tienes ${plural(urgent, 'pendiente', 'pendientes')} por atender.`
    : todayCount
      ? `${student?.first_name} tiene ${plural(todayCount, 'actividad', 'actividades')} para hoy.`
      : week.length
        ? `${student?.first_name} tiene ${plural(week.length, 'actividad', 'actividades')} esta semana.`
        : 'Todo está al día. ¡Que tengas un buen día! ✓';

  const quick = [
    showPayments && { key: 'pay', icon: 'card', label: 'Pagar', to: totals.pending_count ? '/payments/mine?pagar=todo' : '/payments/mine', badge: totals.overdue_count || totals.pending_count, urgent: totals.overdue_count > 0 },
    isOn('grades') && { key: 'grades', icon: 'trendingUp', label: 'Notas', to: '/portal/academico?tab=notas' },
    { key: 'today', icon: 'calendar', label: 'Hoy', to: '/portal/agenda', badge: todayCount },
    isOn('tasks') && { key: 'upload', icon: 'upload', label: 'Subir tarea', to: '/portal/academico?tab=tareas&sub=entregas', badge: tasksToUpload },
  ].filter(Boolean);

  return (
    <div className="fh">
      {/* Banda de bienvenida protegida (DESIGN_SYSTEM.md): igual en los tres portales. */}
      <WelcomeBanner role="Portal de familia" subtitle={status} />

      <div className="fh-grid">
        <div className="fh-main">
          <nav className="fh-quick" aria-label="Accesos rápidos">
            {quick.map((q) => (
              <Link key={q.key} to={q.to} className="fh-quick__btn">
                <span className="fh-quick__icon">
                  <Icon name={q.icon} size={22} />
                  {q.badge > 0 && <span className={`nav-badge ${q.urgent ? 'nav-badge--urgent' : ''}`}>{q.badge > 9 ? '9+' : q.badge}</span>}
                </span>
                <span className="fh-quick__label">{q.label}</span>
              </Link>
            ))}
          </nav>

          {visiblePending.length > 0 && <PendingCard items={visiblePending} nameOf={nameOf} colorOf={colorOf} onConfirm={confirm} confirming={confirming} onSnooze={snooze} />}

          {student && (
            <section className="fh-card" aria-labelledby="fh-week">
              <header className="fh-card__head">
                <h2 id="fh-week" className="fh-card__title">
                  Esta semana · <ChildTag id={student.id} name={student.first_name} colorOf={colorOf} />
                </h2>
                <Link to="/portal/agenda" className="fh-card__more">
                  Agenda <Icon name="chevronRight" size={14} />
                </Link>
              </header>
              {home.loading ? (
                <SkeletonRows n={2} />
              ) : week.length === 0 ? (
                <div className="fh-empty">
                  <span className="fh-empty__icon">🌤️</span>
                  <div>
                    <strong>¡Semana tranquila!</strong>
                    <span>No hay entregas ni evaluaciones en los próximos 7 días.</span>
                  </div>
                </div>
              ) : (
                <ul className="home-list">
                  {week.slice(0, 4).map((w) => (
                    <li key={w.key}>
                      <Link to={w.kind === 'task' ? '/portal/academico?tab=tareas&sub=entregas' : '/portal/academico?tab=tareas&sub=evaluaciones'} className="home-item">
                        <span className={`home-item__icon home-item__icon--${w.kind}`}>
                          <Icon name={w.kind === 'task' ? 'upload' : 'clipboard'} size={18} />
                        </span>
                        <span className="home-item__body">
                          <span className="home-item__title">{w.title}</span>
                          <span className="home-item__detail">{w.detail}</span>
                        </span>
                        {w.signal && <span className={`agenda-chip task-signal--${w.signal.level}`}>{w.signal.level === 'overdue' ? 'Vencida' : w.signal.detail}</span>}
                        {w.heavy && <span className="agenda-chip agenda-chip--heavy">Vale mucho</span>}
                        <span className="home-item__cta">{w.kind === 'task' ? 'Subir' : 'Ver'}</span>
                      </Link>
                    </li>
                  ))}
                  {week.length > 4 && (
                    <li>
                      <Link to="/portal/agenda" className="fh-card__more">
                        Ver {week.length - 4} más <Icon name="chevronRight" size={14} />
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}

          {student && isOn('grades') && <ProgressCard student={student} colorOf={colorOf} loading={home.loading} progress={progress} tasks={home.tasks} />}
        </div>

        <aside className="fh-side">
          {showPayments && <PayMini totals={totals} />}
          <section className="fh-card" aria-labelledby="fh-news">
            <header className="fh-card__head">
              <h2 id="fh-news" className="fh-card__title">
                Novedades
              </h2>
              <Link to="/notifications" className="fh-card__more">
                Ver todas <Icon name="chevronRight" size={14} />
              </Link>
            </header>
            {home.loading ? (
              <SkeletonRows n={3} small />
            ) : news.length === 0 ? (
              <p className="home-muted">Estás al día con los avisos. 👍</p>
            ) : (
              <ul className="home-news">
                {news.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="home-news__item" onClick={() => openNews(n)}>
                      <Icon name={NOTIFICATION_ICONS[n.type] || 'bell'} size={16} />
                      <span>{n.title}</span>
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

/** Chip del hijo con su color (identifica de quién es algo sin leer). */
function ChildTag({ id, name, colorOf }) {
  if (!name) return null;
  return (
    <span className="child-tag" style={{ '--child': colorOf(id) }}>
      <span className="child-tag__dot" aria-hidden="true" />
      {name}
    </span>
  );
}

/**
 * Pendientes en UNA tarjeta: el más urgente a la vista y el resto plegado. Lo
 * no bloqueante se puede posponer ("Recordar mañana"). Si el padre la pliega,
 * queda plegada hasta que aparezca un pendiente nuevo.
 */
function PendingCard({ items, nameOf, colorOf, onConfirm, confirming, onSnooze }) {
  const signature = items.map((p) => p.key).join('|');
  const [expanded, setExpanded] = useState(false);
  const [folded, setFolded] = useState(() => readJson(FOLD_KEY, null) === signature);
  const fold = (value) => {
    setFolded(value);
    writeJson(FOLD_KEY, value ? signature : null);
  };
  const shown = expanded ? items : items.slice(0, 1);
  const blocking = items.some((p) => p.level === 1);

  return (
    <section className={`fh-card fh-pending ${blocking ? 'is-blocking' : ''}`} aria-labelledby="fh-pending">
      <header className="fh-card__head">
        <button type="button" className="fh-pending__toggle" onClick={() => fold(!folded)} aria-expanded={!folded}>
          <h2 id="fh-pending" className="fh-card__title">
            Pendientes <span className={`nav-badge nav-badge--inline ${blocking ? 'nav-badge--urgent' : ''}`}>{items.length}</span>
          </h2>
          <Icon name="chevronDown" size={16} className={`fh-pending__chevron ${folded ? '' : 'is-open'}`} />
        </button>
      </header>
      {!folded && (
        <>
          <ul className="fh-pending__list">
            {shown.map((p) => (
              <li key={p.key} className={`fh-pending__item fh-pending__item--l${p.level}`}>
                <span className="fh-pending__icon">
                  <Icon name={p.icon} size={18} />
                </span>
                <div className="fh-pending__body">
                  <strong>
                    {p.title} {p.child && <ChildTag id={p.child} name={nameOf(p.child)} colorOf={colorOf} />}
                  </strong>
                  {p.text && <span>{p.text}</span>}
                </div>
                <div className="fh-pending__actions">
                  {p.snoozable && (
                    <button type="button" className="fh-link-btn" onClick={() => onSnooze(p.key)}>
                      Recordar mañana
                    </button>
                  )}
                  {p.action && (
                    <Link to={p.action.to} className="btn btn--primary btn--sm">
                      {p.action.label}
                    </Link>
                  )}
                  {p.confirm && (
                    <Button size="sm" icon="checkCircle" onClick={() => onConfirm(p.confirm)} loading={confirming === p.confirm.id} loadingText="Confirmando…">
                      Confirmar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {items.length > 1 && (
            <button type="button" className="fh-link-btn fh-pending__more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? 'Ver menos' : `+ ${plural(items.length - 1, 'pendiente más', 'pendientes más')}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** "Cómo va [hijo]": promedio del período en curso, materias bien / con apoyo y tareas entregadas. */
function ProgressCard({ student, colorOf, loading, progress, tasks }) {
  const due = tasks.filter((t) => t.status !== 'pending' || !t.is_open);
  const delivered = due.filter((t) => t.status !== 'pending').length;
  let body;
  if (student.grades_locked) {
    body = (
      <div className="fh-empty fh-empty--neutral">
        <Icon name="lock" size={20} />
        <div>
          <strong>Las notas están en pausa</strong>
          <span>Se verán de nuevo al ponerte al día con los pagos.</span>
        </div>
      </div>
    );
  } else if (loading) {
    body = <SkeletonRows n={2} />;
  } else if (!progress || progress.graded === 0) {
    body = (
      <div className="fh-empty fh-empty--neutral">
        <span className="fh-empty__icon">📒</span>
        <div>
          <strong>Aún no hay notas{progress ? ` en el ${progress.term}` : ''}</strong>
          <span>Te avisaremos cuando los docentes carguen las primeras.</span>
        </div>
      </div>
    );
  } else {
    // literalFor devuelve el nivel ({ code, label }), no la letra.
    const level = progress.qualitative ? literalFor(progress.average) : null;
    body = (
      <div className="fh-progress">
        <div className="fh-progress__avg">
          <span className="fh-progress__value">{progress.qualitative ? level?.code : progress.average.toFixed(1).replace('.', ',')}</span>
          <span className="fh-progress__label">{progress.qualitative ? level?.label || 'Promedio' : 'Promedio de lo evaluado (sobre 20)'}</span>
        </div>
        <ul className="fh-progress__facts">
          <li className="is-good">
            <Icon name="checkCircle" size={16} /> {plural(progress.good, 'materia va bien', 'materias van bien')}
          </li>
          {progress.support.length > 0 && (
            <li className="is-support">
              <Icon name="alertCircle" size={16} /> {progress.support.length === 1 ? `Necesita apoyo en ${progress.support[0]}` : `Necesita apoyo en ${progress.support.length} materias`}
            </li>
          )}
          {due.length > 0 && (
            <li>
              <Icon name="upload" size={16} /> Tareas entregadas: {delivered} de {due.length}
            </li>
          )}
          <li className="fh-progress__note">
            {progress.graded} de {progress.subjects} materias con notas en el {progress.term}
          </li>
        </ul>
      </div>
    );
  }
  return (
    <section className="fh-card" aria-labelledby="fh-progress">
      <header className="fh-card__head">
        <h2 id="fh-progress" className="fh-card__title">
          Cómo va <ChildTag id={student.id} name={student.first_name} colorOf={colorOf} />
        </h2>
        {!student.grades_locked && (
          <Link to="/portal/academico?tab=notas" className="fh-card__more">
            Ver notas <Icon name="chevronRight" size={14} />
          </Link>
        )}
      </header>
      {body}
    </section>
  );
}

function PayMini({ totals }) {
  const overdue = totals.overdue_count > 0;
  const pending = totals.pending_count > 0;
  return (
    <Link to="/payments/mine" className={`fh-pay ${overdue ? 'is-overdue' : pending ? 'is-pending' : ''}`}>
      <span className="fh-pay__icon">
        <Icon name={overdue ? 'alertCircle' : pending ? 'receipt' : 'checkCircle'} size={20} />
      </span>
      <span className="fh-pay__text">
        <strong>{overdue ? 'Pago vencido' : pending ? `${plural(totals.pending_count, 'pago', 'pagos')} por hacer` : 'Pagos al día'}</strong>
        {pending && <span>{formatAmounts(totals.pending_amounts)}</span>}
      </span>
      <span className="fh-pay__cta">{overdue || pending ? 'Pagar' : 'Ver'}</span>
    </Link>
  );
}

function SkeletonRows({ n = 2, small = false }) {
  return (
    <div className="fh-skeleton" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`skeleton fh-skeleton__row ${small ? 'is-small' : ''}`} />
      ))}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="fh" aria-busy="true" aria-label="Cargando tu portal">
      <WelcomeBanner role="Portal de familia" subtitle="Cargando tu portal…" />
      <div className="fh-quick">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton fh-skeleton__quick" />
        ))}
      </div>
      <div className="fh-card">
        <SkeletonRows n={3} />
      </div>
    </div>
  );
}

export default FamilyHome;
