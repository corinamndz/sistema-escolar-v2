import { useState } from 'react';
import learningApi from '../../../api/endpoints/learning.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import MaterialViewer from './MaterialViewer';
import { AchievementButton, MaterialCard, ProgressBar } from './LearningParts';

/**
 * Aprender en casa: materias con material de apoyo → unidades → temas →
 * tarjetas de material, con el progreso del alumno.
 *
 *   kid = false  vista de la familia: ve qué revisó y logró el alumno
 *   kid = true   modo alumno: al abrir un material queda "revisado" y tiene
 *                el botón "¡Lo logré!", que avanza la barra de la unidad
 *
 * `subjectId` / `onSubjectChange`: la materia abierta (la página la guarda en la URL).
 */
function LearningBrowser({ studentId, kid = false, subjectId, onSubjectChange }) {
  const subjects = useFetch(() => learningApi.studentSubjects(studentId), [studentId]);
  if (subjects.loading) return <Spinner />;
  if (subjects.error) return <Alert>{subjects.error}</Alert>;
  const list = subjects.data.subjects;

  if (!subjects.data.section) return <Alert variant="info">El alumno no tiene una inscripción activa.</Alert>;
  if (list.length === 0) {
    return (
      <div className="learn-empty">
        <Icon name="book" size={32} />
        <p>Todavía no hay material de apoyo publicado.</p>
        <p className="text-sm text-muted">Cuando los docentes publiquen guías, videos o notas de voz, aparecerán aquí por materia.</p>
      </div>
    );
  }
  const selected = list.find((s) => s.id === subjectId);
  if (!selected) {
    return (
      <div className={`learn-subjects ${kid ? 'learn-subjects--kid' : ''}`}>
        {list.map((s) => (
          <button key={s.id} type="button" className="learn-subject" onClick={() => onSubjectChange(s.id)}>
            <span className="learn-subject__icon">
              <Icon name="book" size={kid ? 26 : 20} />
            </span>
            <span className="learn-subject__name">{s.name}</span>
            <ProgressBar progress={s.progress} size="sm" label={kid ? 'Logrados' : 'Avance del alumno'} />
          </button>
        ))}
      </div>
    );
  }
  return <SubjectView studentId={studentId} subject={selected} kid={kid} onBack={() => { subjects.refetch(); onSubjectChange(null); }} />;
}

function SubjectView({ studentId, subject, kid, onBack }) {
  const { data, setData, loading, error } = useFetch(() => learningApi.studentSubject(studentId, subject.id), [studentId, subject.id]);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [celebrate, setCelebrate] = useState(null); // nombre de la unidad completada
  const toast = useToast();

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  /** Actualiza el progreso de un material en pantalla y recalcula unidades y materia. */
  const patchProgress = (materialId, progress) =>
    setData((d) => {
      const units = d.units.map((u) => {
        const topics = u.topics.map((t) => ({
          ...t,
          materials: t.materials.map((m) => (m.id === materialId ? { ...m, student_progress: { viewed_at: progress.viewed_at, completed_at: progress.completed_at } } : m)),
        }));
        const all = topics.flatMap((t) => t.materials);
        const completed = all.filter((m) => m.student_progress.completed_at).length;
        return { ...u, topics, progress: { completed, total: all.length, percent: all.length ? (completed / all.length) * 100 : 0 } };
      });
      const all = units.flatMap((u) => u.topics.flatMap((t) => t.materials));
      const completed = all.filter((m) => m.student_progress.completed_at).length;
      return { ...d, units, progress: { completed, total: all.length, percent: all.length ? (completed / all.length) * 100 : 0 } };
    });

  const open = (m) => {
    if (m.type === 'link') window.open(m.url, '_blank', 'noopener,noreferrer');
    else setViewing(m);
    // Solo el modo alumno cuenta como "revisado por el alumno".
    if (kid && !m.student_progress.viewed_at) {
      learningApi.markViewed(studentId, m.id).then((p) => patchProgress(m.id, p)).catch(() => {});
    }
  };

  const toggle = async (m) => {
    const done = !m.student_progress.completed_at;
    setBusy(m.id);
    try {
      const unit = data.units.find((u) => u.topics.some((t) => t.materials.some((x) => x.id === m.id)));
      const wasComplete = unit && unit.progress.completed === unit.progress.total;
      patchProgress(m.id, await learningApi.setCompleted(studentId, m.id, done));
      if (done && unit && !wasComplete && unit.progress.completed + 1 === unit.progress.total) setCelebrate(unit.name);
      if (viewing?.id === m.id) setViewing((v) => ({ ...v, student_progress: { ...v.student_progress, completed_at: done ? new Date().toISOString() : null } }));
    } catch (err) {
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`learn-subject-view ${kid ? 'learn--kid' : ''}`}>
      <div className="learn-subject-view__head">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Materias
        </button>
        <h2 className="learn-subject-view__title">{data.subject.name}</h2>
        <div className="learn-subject-view__total">
          <Icon name="trophy" size={18} /> {data.progress.completed} de {data.progress.total} logrados
        </div>
      </div>

      {celebrate && (
        <div className="learn-celebrate" role="status">
          <Icon name="trophy" size={28} />
          <div>
            <strong>¡Completaste {celebrate}!</strong>
            <div className="text-sm">Estudiaste todo el material de esta unidad. ¡Excelente trabajo!</div>
          </div>
          <button type="button" className="pc-icon-btn" onClick={() => setCelebrate(null)} aria-label="Cerrar">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {data.units.map((u) => {
        const withMaterial = u.topics.filter((t) => t.materials.length);
        if (!withMaterial.length) return null;
        return (
          <section key={u.name} className="learn-unit">
            <header className="learn-unit__head">
              <h3 className="learn-unit__name">{u.name}</h3>
              <ProgressBar progress={u.progress} label={kid ? 'Mi avance' : 'Avance del alumno'} />
            </header>
            {withMaterial.map((t) => (
              <div key={t.id} className="learn-topic">
                <div className="learn-topic__head">
                  {t.week && <span className="pc-week">Semana {t.week}</span>}
                  <h4 className="learn-topic__title">{t.title}</h4>
                </div>
                {!kid && t.description && <p className="learn-topic__desc">{t.description}</p>}
                <div className="learn-cards">
                  {t.materials.map((m) => (
                    <MaterialCard key={m.id} material={m} kid={kid} busy={busy === m.id} onOpen={() => open(m)} onToggle={() => toggle(m)} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {viewing && (
        <MaterialViewer
          material={viewing}
          loadFile={() => learningApi.familyFile(studentId, viewing.id)}
          onClose={() => setViewing(null)}
          footer={kid && <AchievementButton large done={Boolean(viewing.student_progress.completed_at)} busy={busy === viewing.id} onToggle={() => toggle(viewing)} />}
        />
      )}
    </div>
  );
}

export default LearningBrowser;
