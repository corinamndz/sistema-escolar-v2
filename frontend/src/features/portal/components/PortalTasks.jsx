import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Icon from '../../../components/ui/Icon';
import FileDropzone from '../../../components/ui/FileDropzone';
import { useToast } from '../../../components/ui/Toast';
import { blobErrorMessage } from '../../../utils/download';
import {
  MAX_SUBMISSION_BYTES,
  SUBMISSION_ACCEPT,
  SubmissionBadge,
  deadlineSignal,
  formatBytes,
  formatDay,
  formatDateTime,
  saveDownloaded,
  useNow,
} from '../../submissions/submissionStatus';

/**
 * Aula virtual en el portal del representante: tareas con entrega digital del
 * alumno en tarjetas, separadas en "Por entregar" y "Entregadas".
 *
 * Cada tarjeta muestra arriba la materia y el período, y las pendientes llevan
 * el semáforo de la fecha límite (deadlineSignal): rojo vencida, ámbar ≤ 3 días,
 * verde con más margen. La hora se refresca cada minuto (useNow), así el
 * semáforo cambia sin recargar la página.
 */
function PortalTasks({ studentId }) {
  const { data, loading, error, refetch } = useFetch(() => portalApi.getStudentTasks(studentId), [studentId]);
  const [uploading, setUploading] = useState(null); // tarea a la que se adjunta el archivo
  const now = useNow();

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  // Pendientes: primero las más urgentes (vencidas y luego por hora límite).
  const todo = data.tasks.filter((t) => t.status === 'pending').sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const done = data.tasks.filter((t) => t.status !== 'pending');
  const card = (t) => <TaskCard key={t.id} task={t} studentId={studentId} now={now} onUpload={() => setUploading(t)} />;

  return (
    <>
      {data.grades_locked && (
        <Alert variant="warning">Puedes seguir entregando tareas, pero las notas y comentarios del docente están ocultos mientras haya cuotas vencidas.</Alert>
      )}
      <Card title="Por entregar" subtitle={todo.length ? `${todo.length} tarea(s)` : undefined} actions={todo.length > 0 && <SignalLegend />}>
        {todo.length === 0 ? <p className="text-muted">No hay tareas pendientes. ¡Todo al día!</p> : <div className="task-grid">{todo.map(card)}</div>}
      </Card>
      <Card title="Entregadas" subtitle={done.length ? `${data.totals.graded} calificada(s) de ${done.length}` : undefined}>
        {done.length === 0 ? <p className="text-muted">Aún no hay entregas.</p> : <div className="task-grid">{done.map(card)}</div>}
      </Card>
      {uploading && <UploadDrawer studentId={studentId} task={uploading} onClose={() => setUploading(null)} onSaved={refetch} />}
    </>
  );
}

/** Leyenda del semáforo (junto al título de "Por entregar"). */
function SignalLegend() {
  return (
    <ul className="task-legend" aria-label="Significado de los colores">
      <li><span className="task-signal__dot task-signal__dot--overdue" aria-hidden="true" /> Vencida</li>
      <li><span className="task-signal__dot task-signal__dot--soon" aria-hidden="true" /> 3 días o menos</li>
      <li><span className="task-signal__dot task-signal__dot--ontime" aria-hidden="true" /> A tiempo</li>
    </ul>
  );
}

/** Semáforo de la fecha límite: color + texto (accesible sin depender del color). */
function DeadlineSignal({ deadline, now }) {
  const signal = deadlineSignal(deadline, now);
  return (
    <div className={`task-signal task-signal--${signal.level}`}>
      <span className={`task-signal__dot task-signal__dot--${signal.level}`} aria-hidden="true" />
      <div>
        <strong>{signal.label}</strong> · {signal.detail}
        <div className="task-signal__date">
          <Icon name="clock" size={13} /> Entrega hasta: {formatDateTime(deadline)}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, studentId, now, onUpload }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const s = task.submission;
  const pending = task.status === 'pending';
  const returned = pending && s?.has_file;
  // Borde lateral: semáforo si está pendiente; si ya se entregó, neutro.
  const level = pending ? deadlineSignal(task.deadline, now).level : 'done';

  const download = async () => {
    setDownloading(true);
    try {
      saveDownloaded(await portalApi.downloadTaskFile(studentId, task.id), s.file_original_name);
    } catch (err) {
      toast.error('No se pudo descargar el archivo', await blobErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article className={`task-card task-card--${level}`}>
      <header className="task-card__top">
        <span className="task-card__subject">
          <Icon name="book" size={13} />
          {task.subject} • {task.term_name}
        </span>
        <SubmissionBadge status={task.status} submission={s} />
      </header>

      <h3 className="task-card__title">{task.title}</h3>
      {task.teacher_name && <div className="task-card__meta">Docente: {task.teacher_name}</div>}
      {task.description && <p className="task-card__desc">{task.description}</p>}
      {/* La fecha del plan de evaluación (cuándo se aplica) es distinta de la hora límite de entrega. */}
      {task.applied_on && (
        <div className="task-card__meta">
          <Icon name="calendar" size={13} /> Fecha de la actividad: {formatDay(task.applied_on)}
        </div>
      )}

      {pending ? (
        <DeadlineSignal deadline={task.deadline} now={now} />
      ) : (
        <div className="task-card__meta">
          <Icon name="clock" size={13} /> Entrega hasta: {formatDateTime(task.deadline)}
        </div>
      )}

      {s?.has_file && (
        <div className="task-card__file">
          <Icon name="file" size={14} />
          <span className="task-card__file-name" title={s.file_original_name}>{s.file_original_name}</span>
          <span className="task-card__meta">
            {formatBytes(s.file_size)} · enviado {formatDateTime(s.submitted_at)}
            {s.late && <strong> · fuera de plazo</strong>}
          </span>
        </div>
      )}

      {/* Retroalimentación: la de una entrega devuelta, o la nota y comentarios de una calificada. */}
      {(returned || task.status === 'graded') && s?.teacher_feedback && (
        <Alert variant={returned ? 'warning' : 'info'}>
          <strong>Comentario del docente:</strong> {s.teacher_feedback}
        </Alert>
      )}
      {task.status === 'graded' && s?.grade !== null && (
        <div className="task-card__grade">
          Nota: <strong>{s.grade}</strong> / {task.max_score}
        </div>
      )}

      <footer className="task-card__actions">
        {task.can_submit && (
          <Button size="sm" icon="upload" variant={pending ? 'primary' : 'secondary'} onClick={onUpload}>
            {s?.has_file ? (returned ? 'Subir corrección' : 'Reemplazar archivo') : 'Adjuntar y subir tarea'}
          </Button>
        )}
        {s?.has_file && (
          <Button size="sm" variant="secondary" icon="download" onClick={download} loading={downloading} loadingText="Descargando…">
            Ver lo entregado
          </Button>
        )}
      </footer>
    </article>
  );
}

function UploadDrawer({ studentId, task, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const toast = useToast();
  const { run, loading, error, fieldErrors } = useMutation((f) => portalApi.submitTask(studentId, task.id, f, setProgress));
  const late = deadlineSignal(task.deadline).level === 'overdue';

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    try {
      await run(file);
      toast.success('Tarea entregada', task.title);
      onSaved();
      onClose();
    } catch {
      // el error se muestra en el panel
    }
  };

  return (
    <Drawer title="Entregar tarea" subtitle={`${task.title} · ${task.subject} • ${task.term_name}`} icon="upload" onClose={onClose} busy={loading}>
      <Alert>{error}</Alert>
      <form onSubmit={submit}>
        {late ? (
          <Alert variant="warning">
            La hora límite fue el <strong>{formatDateTime(task.deadline)}</strong>. Puedes entregarla igual, pero el docente la verá marcada como <strong>fuera de plazo</strong>.
          </Alert>
        ) : (
          <p className="text-sm text-muted">
            Hora límite: <strong>{formatDateTime(task.deadline)}</strong>. Puedes reemplazar el archivo mientras el docente no la califique.
          </p>
        )}
        <FileDropzone
          value={file}
          onChange={setFile}
          accept={SUBMISSION_ACCEPT}
          maxBytes={MAX_SUBMISSION_BYTES}
          label="Arrastra la tarea aquí"
          hint="PDF, foto (JPG/PNG), Word, Excel o PowerPoint · máximo 10 MB"
          error={fieldErrors.file}
          disabled={loading}
        />
        {loading && progress > 0 && (
          <div className="task-upload-progress" aria-live="polite">
            <div className="task-upload-progress__bar" style={{ width: `${progress}%` }} />
            <span>Subiendo… {progress}%</span>
          </div>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" icon="upload" loading={loading} loadingText="Subiendo…" disabled={!file}>
            Entregar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default PortalTasks;
