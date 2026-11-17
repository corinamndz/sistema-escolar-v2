import { useEffect } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import { initials } from '../../components/layout/initials';
import { isFamilyUser } from '../../components/layout/navigation';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { FamilyProvider, useFamily } from '../portal/FamilyContext';

/**
 * Pantalla del MODO ALUMNO, fuera del layout del representante: sin menú
 * lateral, sin barra inferior ni accesos a pagos o notas. Una banda superior
 * de color distinto deja claro que se está viendo "con los ojos del alumno" y
 * siempre ofrece volver al modo padre, al mismo hijo y la misma materia.
 */
function StudentModeShell() {
  return (
    <FamilyProvider>
      <ShellContent />
    </FamilyProvider>
  );
}

function ShellContent() {
  const { studentId } = useParams();
  const { search } = useLocation();
  const { user } = useAuth();
  const { settings } = useTenant();
  const family = useFamily();
  const student = family.students.find((s) => s.id === studentId);
  const materia = new URLSearchParams(search).get('materia');

  // El hijo del modo alumno pasa a ser el hijo activo: al volver, el padre sigue con él.
  useEffect(() => {
    if (studentId) family.setStudentId(studentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Fondo y título de pestaña propios mientras dure el modo alumno.
  useEffect(() => {
    document.body.classList.add('is-student-mode');
    const previous = document.title;
    if (student) document.title = `Modo alumno · ${student.first_name}`;
    return () => {
      document.body.classList.remove('is-student-mode');
      document.title = previous;
    };
  }, [student]);

  const exitTo = isFamilyUser(user)
    ? `/portal/academico?tab=aprender${materia ? `&materia=${materia}` : ''}`
    : `/portal/learning?hijo=${studentId}${materia ? `&materia=${materia}` : ''}`;

  return (
    <div className="student-mode">
      {/* Barra flotante translúcida: indica el modo sin gritar; el acento es el color del hijo. */}
      <div className="student-mode__top">
        <header className="student-mode__bar" role="banner" style={student ? { '--child': family.colorOf(student.id) } : undefined}>
          <span className="student-mode__mode" title="Estás viendo el portal como lo ve el alumno">
            <span className="student-mode__mode-icon">
              <Icon name="sparkles" size={12} />
            </span>
            <span className="student-mode__mode-text">Modo alumno</span>
          </span>
          <span className="student-mode__sep" aria-hidden="true" />
          {student && (
            <span className="student-mode__who">
              <span className="student-mode__avatar" aria-hidden="true">
                {initials(`${student.first_name} ${student.last_name}`)}
              </span>
              <span className="student-mode__names">
                <span className="student-mode__label">Viendo como</span>
                <span className="student-mode__name">
                  {student.first_name} {student.last_name}
                </span>
              </span>
            </span>
          )}
          <span className="student-mode__school">{settings.name}</span>
          <Link to={exitTo} className="student-mode__exit" aria-label="Volver al modo padre">
            <Icon name="arrowLeft" size={15} />
            <span>
              Volver<span className="student-mode__exit-long"> al modo padre</span>
            </span>
          </Link>
        </header>
      </div>
      <main className="student-mode__content">
        <Outlet />
      </main>
    </div>
  );
}

export default StudentModeShell;
