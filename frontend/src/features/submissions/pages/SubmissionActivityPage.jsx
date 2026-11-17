import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import submissionsApi from '../../../api/endpoints/submissions.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { blobErrorMessage } from '../../../utils/download';
import { QUALITATIVE_LEVELS, isQualitative, literalOf } from '../../grading/gradingScale';
import { SubmissionBadge, formatBytes, formatDateTime, saveDownloaded, timeLeft } from '../submissionStatus';

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'submitted', label: 'Por calificar' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'graded', label: 'Calificadas' },
];

/**
 * Calificación de las entregas de UNA actividad: cada alumno de las secciones
 * del plan con su estado, el archivo para descargar, la nota y el comentario.
 */
function SubmissionActivityPage() {
  const { activityId } = useParams();
  const [sectionId, setSectionId] = useState('');
  const [statusFilter, setStatusFilter] = useState('submitted');
  const [grading, setGrading] = useState(null); // fila del alumno en el panel de calificación
  const { data, loading, error, refetch } = useFetch(() => submissionsApi.getActivity(activityId, { sectionId: sectionId || undefined }), [activityId, sectionId]);
  const toast = useToast();
  const [downloading, setDownloading] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const { activity, sections, students, totals } = data;
  const qualitative = isQualitative(activity.grading_scale);
  const rows = statusFilter ? students.filter((s) => s.status === statusFilter) : students;

  const download = async (row) => {
    setDownloading(row.student_id);
    try {
      saveDownloaded(await submissionsApi.downloadFile(activityId, row.student_id), row.submission.file_original_name);
    } catch (err) {
      toast.error('No se pudo descargar el archivo', await blobErrorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (r) => (
        <div>
          <div className="cell-person__name">{r.name}</div>
          <div className="cell-person__sub">Sección {r.section.name}</div>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'status', header: 'Estado', render: (r) => <SubmissionBadge status={r.status} submission={r.submission} /> },
    {
      key: 'file',
      header: 'Archivo',
      render: (r) =>
        r.submission?.has_file ? (
          <div>
            <Button size="sm" variant="secondary" icon="download" onClick={() => download(r)} loading={downloading === r.student_id} loadingText="Descargando…">
              {r.submission.file_original_name}
            </Button>
            <div className="cell-person__sub">
              {formatBytes(r.submission.file_size)} · {formatDateTime(r.submission.submitted_at)}
              {r.submission.late && <strong> · fuera de plazo</strong>}
            </div>
          </div>
        ) : (
          <span className="text-muted">{r.status === 'graded' ? 'Entrega física' : 'Sin archivo'}</span>
        ),
    },
    {
      key: 'score',
      header: 'Nota',
      align: 'right',
      render: (r) =>
        r.score !== null ? (
          <strong>{qualitative ? literalOf(r.score, activity.max_score)?.code : `${r.score} / ${activity.max_score}`}</strong>
        ) : (
          <span className="text-muted">—</span>
        ),
      sortValue: (r) => r.score ?? -1,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <RequirePermission module="grading" action="update">
          <Button size="sm" icon={r.status === 'graded' ? 'pencil' : 'check'} variant={r.status === 'submitted' ? 'primary' : 'secondary'} onClick={() => setGrading(r)}>
            {r.status === 'graded' ? 'Editar' : 'Calificar'}
          </Button>
        </RequirePermission>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={activity.title}
        subtitle={
          <span className="page-header__meta">
            {activity.subject} · {activity.grade_name} · {activity.term_name} · Entrega hasta {formatDateTime(activity.submission_deadline)}
            {activity.is_open ? ` (${timeLeft(activity.submission_deadline)})` : ' (plazo vencido: lo que llegue ahora queda fuera de plazo)'}
          </span>
        }
        actions={
          <>
            <Link to={`/grading/plans/${activity.plan_id}`} className="btn btn--secondary">
              <Icon name="spreadsheet" size={16} /> Libreta
            </Link>
            <Link to="/submissions" className="btn btn--secondary">
              <Icon name="arrowLeft" size={16} /> Bandeja
            </Link>
          </>
        }
      />

      {activity.has_indicators && (
        <Alert variant="info">
          Esta actividad se califica por indicadores: carga la nota en la <Link to={`/grading/plans/${activity.plan_id}`}>libreta</Link> y luego márcala aquí como calificada con tu comentario.
        </Alert>
      )}

      <Card
        title={`${totals.submitted} por calificar · ${totals.graded} calificadas · ${totals.pending} pendientes`}
        subtitle={`${totals.students} alumno(s)`}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sections.length > 1 && (
              <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Sección">
                <option value="">Todas las secciones</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    Sección {s.name}
                  </option>
                ))}
              </Select>
            )}
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Estado">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <Table columns={columns} rows={rows} rowKey="student_id" emptyMessage="No hay alumnos con este estado." />
      </Card>

      {grading && (
        <GradeDrawer
          activity={activity}
          row={grading}
          qualitative={qualitative}
          onClose={() => setGrading(null)}
          onSaved={() => {
            setGrading(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

/** Panel para calificar (nota + retroalimentación) o devolver la entrega para corregir. */
function GradeDrawer({ activity, row, qualitative, onClose, onSaved }) {
  const toast = useToast();
  const s = row.submission;
  const [grade, setGrade] = useState(row.score ?? '');
  const [literal, setLiteral] = useState(row.score !== null ? literalOf(row.score, activity.max_score)?.code || '' : '');
  const [feedback, setFeedback] = useState(s?.teacher_feedback || '');
  const save = useMutation((body) => submissionsApi.grade(activity.id, row.student_id, body));
  const giveBack = useMutation((body) => submissionsApi.returnForFix(activity.id, row.student_id, body));
  const busy = save.loading || giveBack.loading;

  const numeric = grade === '' ? null : Number(grade);
  const gradeError =
    activity.has_indicators || qualitative || numeric === null
      ? null
      : numeric < 0 || numeric > activity.max_score
        ? `La nota debe estar entre 0 y ${activity.max_score}.`
        : null;

  const submit = async (e) => {
    e.preventDefault();
    if (gradeError) return;
    const body = { feedback: feedback.trim() || null };
    if (!activity.has_indicators) {
      if (qualitative) body.literal = literal;
      else body.grade = numeric;
    }
    try {
      await save.run(body);
      toast.success('Entrega calificada', row.name);
      onSaved();
    } catch {
      // visible en el panel
    }
  };

  const returnForFix = async () => {
    try {
      await giveBack.run({ feedback });
      toast.success('Entrega devuelta para corregir', row.name);
      onSaved();
    } catch {
      // visible en el panel
    }
  };

  const canReturn = row.status === 'submitted' && s?.has_file;

  return (
    <Drawer title={row.status === 'graded' ? 'Editar calificación' : 'Calificar entrega'} subtitle={row.name} icon="check" onClose={onClose} busy={busy}>
      <Alert>{save.error || giveBack.error}</Alert>
      <form onSubmit={submit}>
        <div className="form-grid">
          {activity.has_indicators ? (
            <Field label="Nota (desde la libreta)" full>
              <div>{row.score !== null ? <strong>{row.score} / {activity.max_score}</strong> : <span className="text-muted">Aún sin nota por indicadores en la libreta.</span>}</div>
            </Field>
          ) : qualitative ? (
            <Field label="Literal" error={save.fieldErrors.literal || save.fieldErrors.grade} full>
              <Select value={literal} onChange={(e) => setLiteral(e.target.value)} required>
                <option value="">Elige el literal</option>
                {QUALITATIVE_LEVELS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code} · {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Nota" error={gradeError || save.fieldErrors.grade} hint={`Sobre ${activity.max_score} puntos.`}>
              <Input type="number" min="0" max={activity.max_score} step="0.01" value={grade} onChange={(e) => setGrade(e.target.value)} suffix={`/ ${activity.max_score}`} required />
            </Field>
          )}
          <Field label="Retroalimentación para la familia" error={save.fieldErrors.feedback || giveBack.fieldErrors.feedback} hint="Opcional al calificar; obligatoria para devolver la entrega." full>
            <textarea className="input" rows={5} maxLength={3000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Ej.: Muy buen análisis. Revisa la ortografía en el segundo párrafo." />
          </Field>
        </div>
        <div className="form-actions">
          {canReturn && (
            <Button type="button" variant="secondary" icon="refresh" onClick={returnForFix} loading={giveBack.loading} disabled={busy || !feedback.trim()} title={!feedback.trim() ? 'Escribe qué debe corregir' : undefined}>
              Devolver para corregir
            </Button>
          )}
          <Button type="submit" icon="check" loading={save.loading} disabled={busy || Boolean(gradeError) || (activity.has_indicators && row.score === null)}>
            Guardar calificación
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default SubmissionActivityPage;
