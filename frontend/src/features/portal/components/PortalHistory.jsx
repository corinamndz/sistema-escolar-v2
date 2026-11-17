import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import AcademicHistory from '../../students/components/AcademicHistory';
import FormPdfButton from '../../enrollment-forms/components/FormPdfButton';

/** Historial académico (años anteriores y el actual) para el representante. */
export default function PortalHistory({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentHistory(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  // Cada año con el diseño de su nivel y su año, solo si el colegio lo publicó.
  const certificates = data.years.filter((y) => (data.certificate_enrollment_ids || []).includes(y.enrollment_id));
  return (
    <Card
      title="Historial académico"
      subtitle="Grados cursados en cada año escolar, resultado y notas finales"
      actions={
        certificates.length > 0 && (
          <span className="cert-portal">
            {certificates.map((y) => (
              <FormPdfButton key={y.enrollment_id} load={() => portalApi.getStudentCertificate(studentId, y.enrollment_id)} fileName={`certificado-${y.school_period.name}.pdf`} label={`Certificado ${y.school_period.name}`} />
            ))}
          </span>
        )
      }
    >
      <AcademicHistory data={data} />
    </Card>
  );
}
