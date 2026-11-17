import { useState } from 'react';
import learningApi from '../../../api/endpoints/learning.api';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Table from '../../../components/ui/Table';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Select from '../../../components/ui/Select';
import { formatDateTime } from '../../submissions/submissionStatus';
import { MATERIAL_TYPES } from '../materialTypes';
import { ProgressBar } from '../components/LearningParts';

const STATUS = {
  completed: { label: '¡Lo logró!', variant: 'success' },
  viewed: { label: 'Lo abrió', variant: 'info' },
  pending: { label: 'Sin revisar', variant: 'neutral' },
};
const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Sin revisar' },
  { value: 'viewed', label: 'Lo abrieron (sin lograr)' },
  { value: 'completed', label: 'Lo lograron' },
];

/**
 * Avance de un material por alumno (docente): quién lo abrió en el modo alumno
 * y quién marcó "¡Lo logré!", con fecha. Útil para saber a quién recordarle.
 */
function MaterialProgressDrawer({ material, onClose }) {
  const { data, loading, error } = useFetch(() => learningApi.materialProgress(material.id), [material.id]);
  const [filter, setFilter] = useState('');
  const [section, setSection] = useState('');

  const columns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (s) => (
        <div>
          <div className="cell-person__name">{s.name}</div>
          <div className="cell-person__sub">Sección {s.section_name}</div>
        </div>
      ),
      sortValue: (s) => s.name,
    },
    { key: 'status', header: 'Estado', render: (s) => <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>, sortValue: (s) => ['pending', 'viewed', 'completed'].indexOf(s.status) },
    {
      key: 'when',
      header: 'Fecha',
      render: (s) =>
        s.completed_at ? `Logrado ${formatDateTime(s.completed_at)}` : s.viewed_at ? `Abierto ${formatDateTime(s.viewed_at)}` : <span className="text-muted">—</span>,
      sortValue: (s) => s.completed_at || s.viewed_at || '',
    },
  ];

  return (
    <Drawer title="Avance de los alumnos" subtitle={material.title} icon={MATERIAL_TYPES[material.type]?.icon} onClose={onClose} size="lg">
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <>
          <div className="learn-progress-summary">
            <ProgressBar progress={{ completed: data.totals.completed, total: data.totals.students, percent: data.totals.students ? (data.totals.completed / data.totals.students) * 100 : 0 }} label="Lo lograron" />
            <div className="learn-progress-summary__counts">
              <span><strong>{data.totals.completed}</strong> lo lograron</span>
              <span><strong>{data.totals.viewed}</strong> lo abrieron</span>
              <span><strong>{data.totals.pending}</strong> sin revisar</span>
            </div>
          </div>
          <div className="learn-progress-filters">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Estado">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
            {data.sections.length > 1 && (
              <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Sección">
                <option value="">Todas las secciones</option>
                {data.sections.map((s) => (
                  <option key={s} value={s}>Sección {s}</option>
                ))}
              </Select>
            )}
          </div>
          <Table
            columns={columns}
            rows={data.students.filter((s) => (!filter || s.status === filter) && (!section || s.section_name === section))}
            rowKey="student_id"
            emptyMessage="No hay alumnos con este estado."
          />
          <p className="form-hint">«Lo abrió» y «¡Lo logró!» se registran cuando el alumno usa el modo alumno desde la cuenta de su representante.</p>
        </>
      )}
    </Drawer>
  );
}

export default MaterialProgressDrawer;
