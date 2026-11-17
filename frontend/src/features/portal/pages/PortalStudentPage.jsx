import { useEffect } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { LevelBadge } from '../../academics/levels';
import { formatAmounts, formatDate, formatMoney } from '../../payments/paymentStatus';
import StudentGrades from '../components/StudentGrades';
import GradesLockedNotice from '../components/GradesLockedNotice';
import ScheduleGrid, { hueOf } from '../../schedules/components/ScheduleGrid';
import { SanctionCard, SeverityTotals } from '../../discipline/components/SanctionParts';
import PortalEvaluations from '../components/PortalEvaluations';
import PortalEvaluationPlan from '../components/PortalEvaluationPlan';
import PortalClubs from '../components/PortalClubs';
import PortalTasks from '../components/PortalTasks';
import PortalRecognitions from '../components/PortalRecognitions';
import PortalCarryovers from '../../carryovers/components/PortalCarryovers';
import { usePortalViews } from '../../../lib/portalViews';
import { useFamily } from '../FamilyContext';
import PortalHistory from '../components/PortalHistory';

// `view`: la clave en Configuración → Vistas del representante (Información siempre se muestra).
const TABS = [
  { key: 'grades', label: 'Calificaciones', view: 'grades' },
  { key: 'plan', label: 'Plan de evaluación', view: 'evaluation_plan' },
  // Aula virtual: tareas con entrega digital (subir el archivo, ver nota y comentarios).
  { key: 'tasks', label: 'Tareas en línea', view: 'tasks' },
  { key: 'schedule', label: 'Horario', view: 'schedule' },
  { key: 'evaluations', label: 'Evaluaciones', view: 'evaluations' },
  { key: 'history', label: 'Historial académico', view: 'history' },
  { key: 'recognitions', label: 'Reconocimientos', view: 'recognitions' },
  { key: 'discipline', label: 'Convivencia', view: 'discipline' },
  { key: 'clubs', label: 'Clubes', view: 'clubs' },
  { key: 'info', label: 'Información' },
];

/**
 * Portal de familia: lo académico vive en «Académico». Las pestañas académicas
 * (y los enlaces de los avisos: ?tab=tasks, ?materia=…) se redirigen allá con
 * este alumno como hijo activo; aquí quedan horario, reconocimientos,
 * convivencia, clubes e información (se llega desde «Más»).
 */
const ACADEMIC_REDIRECT = {
  grades: 'tab=notas',
  plan: 'tab=tareas&sub=plan',
  tasks: 'tab=tareas&sub=entregas',
  evaluations: 'tab=tareas&sub=evaluaciones',
  history: 'tab=historial',
};
const ACADEMIC_TABS = new Set(Object.keys(ACADEMIC_REDIRECT));

/**
 * Detalle de un alumno en el portal del representante. Los datos salen de
 * /portal/me (solo trae a SUS representados), así que un id ajeno no muestra nada.
 */
function PortalStudentPage() {
  const { studentId } = useParams();
  const [params, setParams] = useSearchParams();
  const isOn = usePortalViews();
  const family = useFamily();
  const tabs = TABS.filter((t) => (!t.view || isOn(t.view)) && !(family && ACADEMIC_TABS.has(t.key)));
  const requested = params.get('tab');
  const redirect = family && (ACADEMIC_REDIRECT[requested] || (!requested && params.get('materia') ? 'tab=notas' : null));
  // El alumno de la URL pasa a ser el hijo activo (también al venir de un aviso).
  useEffect(() => {
    if (family && studentId) family.setStudentId(studentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);
  // Pestaña pedida (p. ej. desde un aviso) si está activa; si no, la primera visible.
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : tabs[0].key;
  const { data, loading, error } = useFetch(() => portalApi.getMine(), []);

  if (redirect) {
    const materia = params.get('materia');
    return <Navigate to={`/portal/academico?${redirect}${materia ? `&materia=${materia}` : ''}`} replace />;
  }
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const student = data?.students?.find((s) => s.id === studentId);
  if (!student) {
    return (
      <div className="not-found">
        <h2>Alumno no encontrado</h2>
        <p>Este alumno no está vinculado a tu cuenta.</p>
        <Link to="/" className="btn btn--primary">
          <Icon name="arrowLeft" size={17} /> Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${student.first_name} ${student.last_name}`}
        subtitle={
          <span className="page-header__meta">
            {student.section_id ? (
              <>
                <LevelBadge code={student.level_code} />
                {student.grade_name} · Sección {student.section_name} · {student.school_period_name}
              </>
            ) : (
              'Sin inscripción activa'
            )}
          </span>
        }
        actions={
          <Link to={family ? '/portal/mas' : '/'} className="btn btn--secondary">
            <Icon name="arrowLeft" size={16} /> Volver
          </Link>
        }
      />

      {/* Con cuotas vencidas los detalles (calificaciones) están bloqueados: solo el aviso. */}
      {student.grades_locked ? (
        <>
          <GradesLockedNotice overdueCount={student.payments?.overdue_count} />
          {isOn('tasks') && tab !== 'tasks' && (
            <button type="button" className="btn btn--secondary" style={{ marginBottom: 16 }} onClick={() => setParams({ tab: 'tasks' }, { replace: true })}>
              <Icon name="upload" size={16} /> Entregar tareas en línea
            </button>
          )}
        </>
      ) : (
        <Tabs tabs={tabs} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      )}

      {!student.grades_locked && tab === 'grades' && (
        <>
          {/* En paralelo a su año actual: solo aparece si tiene materias pendientes. */}
          <PortalCarryovers studentId={studentId} />
          <StudentGrades studentId={studentId} />
        </>
      )}
      {/* Las tareas se pueden entregar aunque haya cuotas vencidas (las notas se ocultan en el backend). */}
      {tab === 'tasks' && <PortalTasks studentId={studentId} />}
      {!student.grades_locked && tab === 'plan' && <PortalEvaluationPlan studentId={studentId} />}
      {!student.grades_locked && tab === 'schedule' && <PortalSchedule studentId={studentId} />}
      {!student.grades_locked && tab === 'evaluations' && <PortalEvaluations studentId={studentId} />}
      {!student.grades_locked && tab === 'history' && <PortalHistory studentId={studentId} />}
      {!student.grades_locked && tab === 'discipline' && <PortalSanctions studentId={studentId} />}
      {!student.grades_locked && tab === 'clubs' && <PortalClubs studentId={studentId} />}
      {/* Los logros se celebran aunque haya cuotas vencidas: el enlace del aviso siempre muestra la tarjeta. */}
      {tab === 'recognitions' && <PortalRecognitions studentId={studentId} />}

      {!student.grades_locked && tab === 'info' && (
        <div className="grid grid--2">
          <Card title="Datos del alumno">
            <dl className="detail-list">
              <div className="detail-list__item">
                <dt>Cédula / documento</dt>
                <dd>{student.national_id || '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Parentesco</dt>
                <dd>{student.relationship || '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Grado y sección</dt>
                <dd>{student.section_id ? `${student.grade_name} · ${student.section_name}` : '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Nivel</dt>
                <dd>{student.level_name || '—'}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Pagos" actions={<Link to="/payments/mine" className="btn btn--secondary btn--sm">Ver mis pagos</Link>}>
            <dl className="detail-list">
              <div className="detail-list__item">
                <dt>Por pagar</dt>
                <dd>{student.payments.pending_count ? formatAmounts(student.payments.pending_amounts) : 'Al día'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Vencidos</dt>
                <dd>{student.payments.overdue_count}</dd>
              </div>
              <div className="detail-list__item detail-list__item--full">
                <dt>Próxima mensualidad</dt>
                <dd>
                  {student.payments.next_due
                    ? `${student.payments.next_due.period_label} · ${formatMoney(student.payments.next_due.amount, student.payments.next_due.currency)} · vence el ${formatDate(student.payments.next_due.due_date)}`
                    : '—'}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </div>
  );
}


/** Historial disciplinario del alumno (solo lectura): tipo de falta, motivo, medida, fecha y período. */
function PortalSanctions({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentSanctions(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Card title="Historial disciplinario" subtitle="Faltas y llamados de atención registrados por el colegio">
      <SeverityTotals totals={data.totals} />
      {data.items.length === 0 ? (
        <p className="text-muted">Sin sanciones registradas. ¡Sigue así!</p>
      ) : (
        <div className="sanction-list">
          {data.items.map((s) => (
            <SanctionCard key={s.id} sanction={s} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Horario semanal de la sección del alumno (solo lectura). */
function PortalSchedule({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentSchedule(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Card
      title="Horario de clases"
      subtitle={data.section ? `${data.section.grade_name} · Sección ${data.section.name} · ${data.section.school_period_name}` : undefined}
    >
      {!data.section ? (
        <p className="text-muted">El alumno no tiene una inscripción activa.</p>
      ) : !data.slots.length || !data.entries.length ? (
        <p className="text-muted">El colegio aún no ha publicado el horario de esta sección.</p>
      ) : (
        <ScheduleGrid days={data.days} slots={data.slots} entries={data.entries} colorOf={(e) => hueOf(e.subject_id)} />
      )}
    </Card>
  );
}

export default PortalStudentPage;
