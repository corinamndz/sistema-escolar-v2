import { Link } from 'react-router-dom';
import submissionsApi from '../../../api/endpoints/submissions.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import StatCard from '../../../components/ui/StatCard';
import { formatDateTime, timeLeft } from '../submissionStatus';

/**
 * Bandeja de entregas (aula virtual): las actividades con entrega digital de
 * mi carga docente, con cuántos alumnos entregaron, cuántas faltan por
 * calificar y cuántas están calificadas. Cada fila abre la vista de calificación.
 */
function SubmissionsInboxPage() {
  const { data, loading, error } = useFetch(() => submissionsApi.getInbox(), []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const toGrade = data.reduce((n, a) => n + a.to_grade, 0);
  const open = data.filter((a) => a.is_open).length;

  const columns = [
    {
      key: 'title',
      header: 'Actividad',
      render: (a) => (
        <div>
          <Link to={`/submissions/${a.id}`} className="cell-person__name">
            {a.title}
          </Link>
          <div className="cell-person__sub">
            {a.subject} · {a.grade_name} · {a.term_name}
          </div>
        </div>
      ),
      sortValue: (a) => a.title,
    },
    {
      key: 'deadline',
      header: 'Fecha límite',
      render: (a) => (
        <div>
          {formatDateTime(a.submission_deadline)}
          <div className="cell-person__sub">{a.is_open ? timeLeft(a.submission_deadline) : 'Plazo vencido · se aceptan fuera de plazo'}</div>
        </div>
      ),
      sortValue: (a) => a.submission_deadline,
    },
    {
      key: 'progress',
      header: 'Entregas',
      render: (a) => `${a.to_grade + a.graded + a.returned} de ${a.students}`,
      sortValue: (a) => a.to_grade + a.graded,
    },
    {
      key: 'to_grade',
      header: 'Por calificar',
      align: 'right',
      render: (a) => (a.to_grade ? <Badge variant="warning">{a.to_grade}</Badge> : <span className="text-muted">0</span>),
      sortValue: (a) => a.to_grade,
    },
    {
      key: 'graded',
      header: 'Calificadas',
      align: 'right',
      render: (a) => <Badge variant={a.graded ? 'success' : 'neutral'}>{a.graded}</Badge>,
      sortValue: (a) => a.graded,
    },
  ];

  return (
    <div>
      <PageHeader title="Bandeja de entregas" subtitle="Tareas con entrega digital de tus planes de evaluación" />
      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <StatCard label="Por calificar" value={toGrade} icon="inbox" tone="warning" />
        <StatCard label="Actividades abiertas" value={open} icon="clock" />
        <StatCard label="Actividades con entrega" value={data.length} icon="upload" tone="info" />
      </div>
      <Card>
        <Table
          columns={columns}
          rows={data}
          emptyMessage="Ninguna actividad requiere entrega digital. Actívala al crear o editar una actividad del plan de evaluación."
        />
      </Card>
    </div>
  );
}

export default SubmissionsInboxPage;
