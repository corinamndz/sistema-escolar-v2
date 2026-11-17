import { useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useFamily } from '../../portal/FamilyContext';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import LearningBrowser from '../components/LearningBrowser';

/**
 * Aprender en casa (portal del representante): el material de apoyo de cada
 * materia de sus hijos y cuánto ha revisado y logrado cada uno. Desde aquí se
 * abre el "modo alumno" para que el niño estudie y marque "¡Lo logré!".
 * URL: ?hijo=<studentId>&materia=<subjectId>
 */
function PortalLearningPage() {
  const [params, setParams] = useSearchParams();
  const family = useFamily();
  const { data, loading, error } = useFetch(() => portalApi.getMine(), []);
  // Portal de familia: «Aprender» vive en Académico (los avisos de material nuevo traen ?materia=).
  useEffect(() => {
    if (family && params.get('hijo')) family.setStudentId(params.get('hijo'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (family) {
    const materia = params.get('materia');
    return <Navigate to={`/portal/academico?tab=aprender${materia ? `&materia=${materia}` : ''}`} replace />;
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const students = (data?.students || []).filter((s) => s.section_id);
  if (!students.length) return <Alert variant="info">No hay alumnos con inscripción activa vinculados a tu cuenta.</Alert>;

  const current = students.find((s) => s.id === params.get('hijo')) || students[0];
  const subjectId = params.get('materia');
  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Aprender en casa"
        subtitle="Guías, videos y notas de voz de los docentes para repasar con tus hijos"
        actions={
          <Link to={`/portal/learning/${current.id}/alumno${subjectId ? `?materia=${subjectId}` : ''}`} className="btn btn--primary">
            <Icon name="sparkles" size={16} /> Modo alumno
          </Link>
        }
      />
      {students.length > 1 && (
        <div className="learn-children" role="tablist" aria-label="Alumno">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current.id}
              className={`learn-child ${s.id === current.id ? 'is-active' : ''}`}
              onClick={() => update({ hijo: s.id, materia: null })}
            >
              <span className="learn-child__name">{s.first_name}</span>
              <span className="learn-child__grade">{s.grade_name}</span>
            </button>
          ))}
        </div>
      )}
      <Card>
        <LearningBrowser key={current.id} studentId={current.id} subjectId={subjectId} onSubjectChange={(id) => update({ hijo: current.id, materia: id })} />
      </Card>
      <p className="form-hint">
        «Revisado» y «Logrado» los registra {current.first_name} en el modo alumno: ábrelo en este dispositivo para que estudie con su propia vista.
      </p>
    </div>
  );
}

export default PortalLearningPage;
