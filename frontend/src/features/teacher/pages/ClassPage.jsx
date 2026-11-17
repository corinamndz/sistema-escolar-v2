import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import gradingApi from '../../../api/endpoints/grading.api';
import submissionsApi from '../../../api/endpoints/submissions.api';
import programmaticContentApi from '../../../api/endpoints/programmaticContent.api';
import teacherApi from '../../../api/endpoints/teacher.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { useAuth } from '../../../context/AuthContext';
import Tabs from '../../../components/ui/Tabs';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { REVIEW_STATUSES } from '../../reviews/reviewCatalog';
import MaterialsDrawer from '../../learning/teacher/MaterialsDrawer';
import { formatDateTime } from '../../submissions/submissionStatus';
import { classLabel, subjectColor, useTeacher } from '../TeacherContext';
import GradeGrid from '../grading/GradeGrid';

/**
 * Mis clases: todo lo de la CLASE ACTIVA (sección + materia, elegida en el
 * selector de arriba) en pestañas. Cambiar de clase conserva la pestaña.
 *   notas     libreta rápida del plan del período (GradeGrid)
 *   entregas  tareas en línea de esta clase y cuántas faltan por calificar
 *   plan      planes de evaluación de la clase por período, con su revisión
 *   material  temas del contenido programático con su material de apoyo
 *   alumnos   lista de la sección
 * URL: ?tab=…&plan=…
 */
const TABS = [
  { key: 'notas', label: 'Notas' },
  { key: 'entregas', label: 'Entregas' },
  { key: 'plan', label: 'Plan' },
  { key: 'material', label: 'Material' },
  { key: 'alumnos', label: 'Alumnos' },
];

function ClassPage() {
  const teacher = useTeacher();
  const [params, setParams] = useSearchParams();
  const [editingLink, setEditingLink] = useState(false);
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'notas';
  const go = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  // Fuera del portal docente (p. ej. administrador con ficha docente) no hay clase activa.
  if (!teacher) return <Navigate to="/" replace />;
  if (teacher.loading) return <Spinner />;
  if (teacher.error) return <Alert>{teacher.error}</Alert>;
  const active = teacher.active;
  if (!active) return <Alert variant="info">Aún no tienes clases asignadas en tu carga docente. Pide a la coordinación que te asigne tus secciones y materias.</Alert>;

  return (
    <div className="tc" style={{ '--subject': subjectColor(active.subject_id) }}>
      <header className="tc-head">
        <div className="tc-head__main">
          <span className="tc-head__dot" aria-hidden="true" />
          <div>
            <h1 className="tc-head__title">{active.subject_name}</h1>
            <p className="tc-head__sub">
              {active.grade_name} · Sección {active.section_name} · {active.school_period_name}
            </p>
          </div>
        </div>
        <div className="tc-head__actions">
          {active.link ? (
            <>
              <a className="btn btn--primary btn--sm" href={active.link.url} target="_blank" rel="noopener noreferrer">
                <Icon name="video" size={15} /> {active.link.label ? `Entrar a ${active.link.label}` : 'Entrar a la clase en línea'}
              </a>
              <button type="button" className="pc-icon-btn" onClick={() => setEditingLink(true)} aria-label="Editar el enlace de clase en línea" title="Editar enlace">
                <Icon name="pencil" size={15} />
              </button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon="link" onClick={() => setEditingLink(true)}>
              Agregar enlace de clase en línea
            </Button>
          )}
        </div>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={(key) => go({ tab: key })} />

      {/* key: al cambiar de clase todo se recarga, conservando la pestaña. */}
      <div key={active.key}>
        {tab === 'notas' && <GradesTab cls={active} planParam={params.get('plan')} onPlan={(id) => go({ plan: id })} />}
        {tab === 'entregas' && <SubmissionsTab cls={active} />}
        {tab === 'plan' && <PlansTab cls={active} />}
        {tab === 'material' && <MaterialTab cls={active} />}
        {tab === 'alumnos' && <StudentsTab cls={active} />}
      </div>

      {editingLink && <LinkDrawer cls={active} onClose={() => setEditingLink(false)} onSaved={teacher.refetch} />}
    </div>
  );
}

/** Planes de evaluación de la clase (su sección y materia, en su año), por período. */
function useClassPlans(cls) {
  const { data, loading, error, refetch } = useFetch(() => evaluationPlansApi.list({ sectionId: cls.section_id }), [cls.section_id]);
  const plans = useMemo(
    () =>
      (data || [])
        .filter((p) => p.school_period_id === cls.school_period_id && (p.subject_id ? p.subject_id === cls.subject_id : String(p.subject_name).toLowerCase() === cls.subject_name.toLowerCase()))
        .sort((a, b) => (a.term_number || 0) - (b.term_number || 0)),
    [data, cls]
  );
  return { plans, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

function GradesTab({ cls, planParam, onPlan }) {
  const { plans, loading, error } = useClassPlans(cls);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!plans.length) return <NoPlan cls={cls} />;
  // Plan pedido; si no, el último período que ya tiene actividades.
  const plan = plans.find((p) => p.id === planParam) || [...plans].reverse().find((p) => p.activity_count > 0) || plans[0];
  return (
    <section className="fh-card">
      <header className="fh-card__head tc-grades-head">
        {plans.length > 1 ? (
          <div className="segmented" role="tablist" aria-label="Período">
            {plans.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={p.id === plan.id} className={`segmented__item ${p.id === plan.id ? 'segmented__item--active' : ''}`} onClick={() => onPlan(p.id)}>
                {p.term_name}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="fh-card__title">{plan.term_name}</h2>
        )}
        <Link to={`/grading/plans/${plan.id}`} className="fh-card__more">
          Libreta completa <Icon name="chevronRight" size={14} />
        </Link>
      </header>
      <PlanGrid planId={plan.id} sectionId={cls.section_id} />
    </section>
  );
}

function PlanGrid({ planId, sectionId }) {
  const { data, loading, error, refetch } = useFetch(() => gradingApi.getGradebook(planId, { sectionId }), [planId, sectionId]);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return <GradeGrid gradebook={data} onReload={refetch} />;
}

function NoPlan({ cls }) {
  return (
    <div className="fh-empty fh-empty--neutral">
      <span className="fh-empty__icon">🗂️</span>
      <div>
        <strong>Esta clase aún no tiene plan de evaluación</strong>
        <span>
          Crea el plan de {cls.subject_name} para {cls.grade_name} {cls.section_name} y aquí podrás cargar las notas.{' '}
          <Link to="/evaluation-plans">Ir a planes de evaluación</Link>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------

function SubmissionsTab({ cls }) {
  const { plans, loading: lp } = useClassPlans(cls);
  const { data, loading, error } = useFetch(() => submissionsApi.getInbox(), []);
  if (loading || lp) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const ids = new Set(plans.map((p) => p.id));
  const list = (data || []).filter((a) => ids.has(a.plan_id));
  return (
    <section className="fh-card">
      {list.length === 0 ? (
        <div className="fh-empty fh-empty--neutral">
          <span className="fh-empty__icon">📥</span>
          <div>
            <strong>Sin tareas en línea en esta clase</strong>
            <span>Activa «Requiere entrega digital» en una actividad del plan para recibir archivos de los alumnos.</span>
          </div>
        </div>
      ) : (
        <ul className="fp-list">
          {list.map((a) => (
            <li key={a.id} className="fp-row">
              <div className="fp-row__main">
                <span className="fp-row__title">{a.title}</span>
                <span className="fp-row__meta">
                  {a.term_name} · hora límite {formatDateTime(a.submission_deadline)} · {a.to_grade + a.graded + a.returned} de {a.students} entregaron
                </span>
              </div>
              {a.to_grade > 0 ? <Badge variant="warning">{a.to_grade} por calificar</Badge> : <Badge variant="success">Al día</Badge>}
              <Link to={`/submissions/${a.id}`} className="btn btn--secondary btn--sm">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function PlansTab({ cls }) {
  const { plans, loading, error } = useClassPlans(cls);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!plans.length) return <NoPlan cls={cls} />;
  return (
    <section className="fh-card">
      <ul className="fp-list">
        {plans.map((p) => {
          const review = REVIEW_STATUSES[p.review_status] || REVIEW_STATUSES.borrador;
          const weight = Math.round(Number(p.total_weight) * 100) / 100;
          return (
            <li key={p.id} className="fp-row">
              <div className="fp-row__main">
                <span className="fp-row__title">{p.term_name}</span>
                <span className="fp-row__meta">
                  {p.activity_count} actividades · suma {weight} %{p.status === 'closed' ? ' · cerrado' : ''}
                </span>
                <div className="learn-progress__track tc-weight" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weight} aria-label="Ponderación">
                  <div className="learn-progress__fill" style={{ width: `${Math.min(100, weight)}%` }} />
                </div>
              </div>
              <Badge variant={review.variant}>{review.label}</Badge>
              <Link to={`/evaluation-plans/${p.id}`} className="btn btn--secondary btn--sm">
                Abrir plan
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

function MaterialTab({ cls }) {
  const { can } = useAuth();
  const { data, loading, error, refetch } = useFetch(
    () => programmaticContentApi.get({ gradeId: cls.grade_id, subjectId: cls.subject_id, schoolPeriodId: cls.school_period_id }),
    [cls.grade_id, cls.subject_id, cls.school_period_id]
  );
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const units = data?.units || [];
  if (!units.length) {
    return (
      <div className="fh-empty fh-empty--neutral">
        <span className="fh-empty__icon">📚</span>
        <div>
          <strong>Aún no hay temas en el contenido programático</strong>
          <span>
            El material de apoyo se organiza por tema. <Link to={`/programmatic-content?materia=${cls.subject_id}&grado=${cls.grade_id}&ano=${cls.school_period_id}`}>Agregar temas</Link>
          </span>
        </div>
      </div>
    );
  }
  return (
    <section className="fh-card">
      {units.map((u) => (
        <div key={u.unit} className="tc-unit">
          <h3 className="fp-month__title">{u.unit}</h3>
          <ul className="fp-list">
            {u.items.map((item) => (
              <li key={item.id} className="fp-row">
                <div className="fp-row__main">
                  <span className="fp-row__title">
                    {item.week_number && <span className="pc-week">Semana {item.week_number}</span>}
                    {item.topic}
                  </span>
                  <span className="fp-row__meta">
                    {item.materials_count ? `${item.materials_count} material(es) · ${item.materials_published} visibles para las familias` : 'Sin material de apoyo'}
                  </span>
                </div>
                <Button size="sm" variant={item.materials_count ? 'secondary' : 'primary'} icon={item.materials_count ? 'book' : 'plus'} onClick={() => setOpen({ item, unit: u.unit })}>
                  {item.materials_count ? 'Ver material' : 'Agregar'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && <MaterialsDrawer item={open.item} unit={open.unit} canEdit={can('evaluation_plans', 'update')} onClose={() => setOpen(null)} onChanged={refetch} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Alumnos
// ---------------------------------------------------------------------------

function StudentsTab({ cls }) {
  const { data, loading, error } = useFetch(() => teacherApi.sectionStudents(cls.section_id), [cls.section_id]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <section className="fh-card">
      <header className="fh-card__head">
        <h2 className="fh-card__title">
          {data.length} {data.length === 1 ? 'alumno' : 'alumnos'} · {cls.grade_name} {cls.section_name}
        </h2>
      </header>
      <ol className="tc-students">
        {data.map((s) => (
          <li key={s.id}>
            <Link to={`/students/${s.id}`} className="tc-student">
              <span className="tc-student__name">
                {s.last_name}, {s.first_name}
              </span>
              <span className="tc-student__id">{s.national_id || ''}</span>
              <Icon name="chevronRight" size={15} />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Enlace de clase en línea
// ---------------------------------------------------------------------------

function LinkDrawer({ cls, onClose, onSaved }) {
  const toast = useToast();
  const [url, setUrl] = useState(cls.link?.url || '');
  const [label, setLabel] = useState(cls.link?.label || '');
  const { run, loading, error, fieldErrors } = useMutation((body) => teacherApi.setLink(cls.section_id, cls.subject_id, body));
  const valid = !url.trim() || /^https:\/\/\S+\.\S+/i.test(url.trim());
  const save = async (body, message) => {
    try {
      await run(body);
      toast.success(message, classLabel(cls));
      onSaved();
      onClose();
    } catch {
      // visible en el panel
    }
  };
  return (
    <Drawer title="Clase en línea" subtitle={classLabel(cls)} icon="video" onClose={onClose} busy={loading}>
      <Alert>{error}</Alert>
      <p className="text-sm text-muted">El enlace aparece en «Hoy» junto a esta clase y en su cabecera, para entrar con un toque.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && url.trim()) save({ url: url.trim(), label: label.trim() || null }, 'Enlace guardado');
        }}
      >
        <div className="form-grid">
          <Field label="Enlace (Meet, Zoom, Teams…)" error={fieldErrors.url || (!valid ? 'Debe empezar por https://' : null)} full>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://meet.google.com/abc-defg-hij" autoFocus />
          </Field>
          <Field label="Nombre (opcional)" error={fieldErrors.label} hint="Ej.: Meet, Zoom" full>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </Field>
        </div>
        <div className="form-actions">
          {cls.link && (
            <Button type="button" variant="ghost" onClick={() => save({ url: null }, 'Enlace quitado')} disabled={loading}>
              Quitar enlace
            </Button>
          )}
          <Button type="submit" loading={loading} disabled={!valid || !url.trim()}>
            Guardar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default ClassPage;
