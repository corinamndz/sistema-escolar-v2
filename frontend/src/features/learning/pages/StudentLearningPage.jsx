import { useParams, useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import LearningBrowser from '../components/LearningBrowser';
import { useFamily } from '../../portal/FamilyContext';

/**
 * Modo alumno (dentro de la cuenta del representante, sin crear cuentas para
 * menores): vista amigable con tarjetas grandes, el visor integrado y el botón
 * "¡Lo logré!" que avanza la barra de cada unidad. El tamaño se adapta al
 * nivel (Inicial y Primaria, más grande). La banda superior con
 * "Volver al modo padre" la pone StudentModeShell.
 */
function StudentLearningPage() {
  const { studentId } = useParams();
  const [params, setParams] = useSearchParams();
  // Los datos de la familia los carga la pantalla del modo alumno (StudentModeShell).
  const family = useFamily();

  if (family.loading) return <Spinner />;
  if (family.error) return <Alert>{family.error}</Alert>;
  const student = family.students.find((s) => s.id === studentId);
  if (!student) return <Alert>Este alumno no está vinculado a tu cuenta.</Alert>;

  const level = ['initial', 'primary'].includes(student.level_code) ? 'young' : 'teen';
  const subjectId = params.get('materia');

  return (
    <div className={`learn-kid learn-kid--${level}`}>
      <header className="learn-kid__hero">
        <div>
          <p className="learn-kid__hello">¡Hola, {student.first_name}!</p>
          <h1 className="learn-kid__title">¿Qué vamos a aprender hoy?</h1>
          <p className="learn-kid__sub">
            {student.grade_name} · Sección {student.section_name}
          </p>
        </div>
      </header>
      <LearningBrowser
        kid
        studentId={student.id}
        subjectId={subjectId}
        onSubjectChange={(id) => setParams(id ? { materia: id } : {}, { replace: true })}
      />
    </div>
  );
}

export default StudentLearningPage;
