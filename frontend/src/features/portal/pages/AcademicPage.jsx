import { Link, useSearchParams } from 'react-router-dom';
import Tabs from '../../../components/ui/Tabs';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { LevelBadge } from '../../academics/levels';
import { usePortalViews } from '../../../lib/portalViews';
import { useFamily } from '../FamilyContext';
import StudentGrades from '../components/StudentGrades';
import GradesLockedNotice from '../components/GradesLockedNotice';
import PortalTasks from '../components/PortalTasks';
import PortalEvaluations from '../components/PortalEvaluations';
import PortalEvaluationPlan from '../components/PortalEvaluationPlan';
import PortalHistory from '../components/PortalHistory';
import PortalCarryovers from '../../carryovers/components/PortalCarryovers';
import LearningBrowser from '../../learning/components/LearningBrowser';

/**
 * Académico (portal de familia): lo escolar del HIJO ACTIVO en 4 pestañas.
 *   notas      calificaciones (y materias pendientes)
 *   tareas     Tareas en línea · Evaluaciones · Plan de evaluación (subpestañas)
 *   aprender   material de apoyo (y acceso al modo alumno)
 *   historial  años anteriores y certificados
 * URL: ?tab=…&sub=…&materia=… (los avisos enlazan directo a cada lugar).
 *
 * Con cuotas vencidas, notas, evaluaciones e historial muestran el aviso de
 * bloqueo; las tareas en línea y el material de apoyo siguen disponibles.
 */
const TABS = [
  { key: 'notas', label: 'Notas', views: ['grades'] },
  { key: 'tareas', label: 'Tareas y evaluaciones', views: ['tasks', 'evaluations', 'evaluation_plan'] },
  { key: 'aprender', label: 'Aprender', views: ['learning'] },
  { key: 'historial', label: 'Historial', views: ['history'] },
];
const SUBTABS = [
  { key: 'entregas', label: 'Tareas en línea', view: 'tasks' },
  { key: 'evaluaciones', label: 'Evaluaciones', view: 'evaluations' },
  { key: 'plan', label: 'Plan de evaluación', view: 'evaluation_plan' },
];

function AcademicPage() {
  const family = useFamily();
  const [params, setParams] = useSearchParams();
  const isOn = usePortalViews();

  if (family.loading) return <Spinner />;
  if (family.error) return <Alert>{family.error}</Alert>;
  const student = family.student;
  if (!student) return <Alert variant="info">Aún no tienes alumnos vinculados a tu cuenta.</Alert>;

  const tabs = TABS.filter((t) => t.views.some(isOn));
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : tabs[0]?.key;
  const subtabs = SUBTABS.filter((s) => isOn(s.view));
  const sub = subtabs.some((s) => s.key === params.get('sub')) ? params.get('sub') : subtabs[0]?.key;
  const locked = Boolean(student.grades_locked);
  const go = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const lockedNotice = <GradesLockedNotice overdueCount={student.payments?.overdue_count} studentName={student.first_name} />;
  // El modo alumno abre el material de apoyo (vista «learning») del hijo activo, en la materia abierta.
  const studentModeTo =
    isOn('learning') && student.section_id
      ? `/portal/learning/${student.id}/alumno${tab === 'aprender' && params.get('materia') ? `?materia=${params.get('materia')}` : ''}`
      : null;

  return (
    <div>
      <header className="family-page-head">
        <div>
          <h1 className="family-page-head__title">
            {student.first_name} {student.last_name}
          </h1>
          <p className="family-page-head__sub">
            {student.section_id ? (
              <>
                <LevelBadge code={student.level_code} /> {student.grade_name} · Sección {student.section_name}
              </>
            ) : (
              'Sin inscripción activa'
            )}
          </p>
        </div>
        {/* Modo alumno: acción principal de la cabecera, en todas las pestañas. */}
        {studentModeTo && (
          <Link to={studentModeTo} className="student-mode-cta" style={{ '--child': family.colorOf(student.id) }}>
            <span className="student-mode-cta__icon">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="student-mode-cta__text">
              <strong>Modo alumno</strong>
              <span>Que {student.first_name} estudie con su propia vista</span>
            </span>
            <Icon name="chevronRight" size={16} />
          </Link>
        )}
      </header>

      {!tabs.length ? (
        <Alert variant="info">El colegio no tiene secciones académicas activas en el portal.</Alert>
      ) : (
        <Tabs tabs={tabs} active={tab} onChange={(key) => go({ tab: key, sub: null, materia: null })} />
      )}

      {tab === 'notas' &&
        (locked ? (
          lockedNotice
        ) : (
          <>
            <PortalCarryovers studentId={student.id} />
            <StudentGrades key={student.id} studentId={student.id} />
          </>
        ))}

      {tab === 'tareas' && (
        <>
          {subtabs.length > 1 && (
            <div className="segmented" role="tablist" aria-label="Tareas y evaluaciones">
              {subtabs.map((s) => (
                <button key={s.key} type="button" role="tab" aria-selected={sub === s.key} className={`segmented__item ${sub === s.key ? 'segmented__item--active' : ''}`} onClick={() => go({ sub: s.key })}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {/* Las tareas se pueden entregar aunque haya cuotas vencidas (la nota se oculta en el backend). */}
          {sub === 'entregas' && <PortalTasks key={student.id} studentId={student.id} />}
          {sub === 'evaluaciones' && (locked ? lockedNotice : <PortalEvaluations key={student.id} studentId={student.id} />)}
          {sub === 'plan' && (locked ? lockedNotice : <PortalEvaluationPlan key={student.id} studentId={student.id} />)}
        </>
      )}

      {tab === 'aprender' && (
        <section className="card">
          {/* Invitación al modo alumno: qué es y para qué sirve, antes del contenido. */}
          {studentModeTo && (
            <div className="student-mode-invite" style={{ '--child': family.colorOf(student.id) }}>
              <span className="student-mode-invite__art" aria-hidden="true">
                🎒
              </span>
              <div className="student-mode-invite__text">
                <strong>¿Va a estudiar {student.first_name}?</strong>
                <span>Abre el modo alumno y pásale el dispositivo: verá sus materiales en grande y podrá marcar «¡Lo logré!». Tú vuelves con un toque.</span>
              </div>
              <Link to={studentModeTo} className="btn btn--primary">
                <Icon name="sparkles" size={16} /> Abrir modo alumno
              </Link>
            </div>
          )}
          <div className="card__header">
            <div>
              <h3 className="card__title">Aprender en casa</h3>
              <p className="card__subtitle">Lo que ves aquí es la vista de seguimiento: qué revisó y qué logró {student.first_name}</p>
            </div>
          </div>
          <LearningBrowser key={student.id} studentId={student.id} subjectId={params.get('materia')} onSubjectChange={(id) => go({ materia: id })} />
        </section>
      )}

      {tab === 'historial' && (locked ? lockedNotice : <PortalHistory studentId={student.id} />)}
    </div>
  );
}

export default AcademicPage;
