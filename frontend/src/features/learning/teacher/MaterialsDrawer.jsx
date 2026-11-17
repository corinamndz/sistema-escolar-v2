import { useState } from 'react';
import learningApi from '../../../api/endpoints/learning.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { formatDateTime } from '../../submissions/submissionStatus';
import { KIND_LABELS, MATERIAL_TYPES, VISIBILITY, formatDuration } from '../materialTypes';
import MaterialEditorDrawer from './MaterialEditorDrawer';
import MaterialViewer from '../components/MaterialViewer';
import MaterialProgressDrawer from './MaterialProgressDrawer';

/**
 * Material de apoyo de UN tema (docente): lista en orden, con su visibilidad y
 * cuántos alumnos lo revisaron; agregar por tipo, editar, ordenar, previsualizar
 * y eliminar. `canEdit` = false: solo lectura (sin permiso de edición).
 */
function MaterialsDrawer({ item, unit, canEdit, onClose, onChanged }) {
  const { data, loading, error, refetch } = useFetch(() => learningApi.listMaterials(item.id), [item.id]);
  const [editing, setEditing] = useState(null); // null | { type } | material
  const [viewing, setViewing] = useState(null);
  const [progressOf, setProgressOf] = useState(null); // material cuyo avance por alumno se muestra
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const topicLabel = `${unit} · ${item.topic}`;

  const changed = () => {
    refetch();
    onChanged?.();
  };

  const move = async (index, delta) => {
    const ids = data.materials.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    setBusy(true);
    try {
      await learningApi.reorder(item.id, ids);
      changed();
    } catch (err) {
      toast.error('No se pudo reordenar', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    const ok = await confirm({
      title: `¿Eliminar "${m.title}"?`,
      message: m.stats?.completed ? `${m.stats.completed} alumno(s) ya lo marcaron como logrado: también se borrará ese progreso.` : 'Las familias dejarán de verlo.',
      icon: 'trash',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await learningApi.deleteMaterial(m.id);
      toast.success('Material eliminado', m.title);
      changed();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <Drawer title="Material de apoyo" subtitle={topicLabel} icon="book" onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      {canEdit && (
        <div className="learn-add">
          <span className="text-sm text-muted">Agregar:</span>
          {Object.entries(MATERIAL_TYPES).map(([key, t]) => (
            <button key={key} type="button" className={`learn-add__btn learn-tone--${t.tone}`} onClick={() => setEditing({ type: key })}>
              <Icon name={t.icon} size={16} /> {t.short}
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <Spinner />
      ) : data && data.materials.length === 0 ? (
        <div className="learn-empty">
          <Icon name="book" size={28} />
          <p>Este tema aún no tiene material de apoyo.</p>
          <p className="text-sm text-muted">Sube guías, enlaza videos o graba una nota de voz para que las familias repasen en casa.</p>
        </div>
      ) : (
        data && (
          <ol className="learn-admin-list">
            {data.materials.map((m, i) => {
              const t = MATERIAL_TYPES[m.type];
              const vis = VISIBILITY[m.visibility.status];
              return (
                <li key={m.id} className="learn-admin-item">
                  <span className={`learn-admin-item__icon learn-tone--${t.tone}`}>
                    <Icon name={t.icon} size={18} />
                  </span>
                  <div className="learn-admin-item__main">
                    <button type="button" className="learn-admin-item__title" onClick={() => setViewing(m)} title="Vista previa">
                      {m.title}
                    </button>
                    <div className="learn-admin-item__meta">
                      <Badge variant={vis.variant}>
                        {vis.label}
                        {m.visibility.status === 'scheduled' ? ` · ${formatDateTime(m.visibility.publish_at)}` : ''}
                      </Badge>
                      <span>{m.type === 'file' ? KIND_LABELS[m.kind] : t.short}</span>
                      {formatDuration(m.duration_seconds) && <span>{formatDuration(m.duration_seconds)}</span>}
                      {m.visibility.status === 'published' && (
                        <button type="button" className="learn-stats" onClick={() => setProgressOf(m)} title="Ver el avance de cada alumno">
                          <Icon name="checkCircle" size={13} /> {m.stats.completed} de {data.students} lo lograron
                          <span aria-hidden="true">·</span>
                          <Icon name="eye" size={13} /> {m.stats.viewed} lo abrieron
                          <span className="learn-stats__more">Ver alumnos</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="learn-admin-item__actions">
                      <button type="button" className="pc-icon-btn" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Subir ${m.title}`} title="Subir">
                        <Icon name="arrowUp" size={15} />
                      </button>
                      <button type="button" className="pc-icon-btn" onClick={() => move(i, 1)} disabled={busy || i === data.materials.length - 1} aria-label={`Bajar ${m.title}`} title="Bajar">
                        <Icon name="arrowDown" size={15} />
                      </button>
                      <button type="button" className="pc-icon-btn" onClick={() => setEditing(m)} aria-label={`Editar ${m.title}`} title="Editar">
                        <Icon name="pencil" size={15} />
                      </button>
                      <button type="button" className="pc-icon-btn pc-icon-btn--danger" onClick={() => remove(m)} aria-label={`Eliminar ${m.title}`} title="Eliminar">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )
      )}
      <p className="form-hint">
        Las familias ven el material publicado de los temas visibles en su portal (con la revisión académica activa, cuando el programa está aprobado). El material no necesita
        revisión: coordinación puede devolverlo a borrador.
      </p>

      {editing && (
        <MaterialEditorDrawer
          contentId={item.id}
          topicLabel={topicLabel}
          initial={editing.id ? editing : { type: editing.type }}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
      {progressOf && <MaterialProgressDrawer material={progressOf} onClose={() => setProgressOf(null)} />}
      {viewing && (
        <MaterialViewer
          material={viewing}
          loadFile={() => learningApi.staffFile(viewing.id)}
          onClose={() => setViewing(null)}
          footer={
            canEdit && (
              <Button variant="secondary" icon="pencil" onClick={() => { setEditing(viewing); setViewing(null); }}>
                Editar
              </Button>
            )
          }
        />
      )}
    </Drawer>
  );
}

export default MaterialsDrawer;
