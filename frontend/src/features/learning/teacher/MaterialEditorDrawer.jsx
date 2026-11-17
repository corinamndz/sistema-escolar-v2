import { useMemo, useState } from 'react';
import learningApi from '../../../api/endpoints/learning.api';
import { useMutation } from '../../../hooks/useMutation';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import FileDropzone from '../../../components/ui/FileDropzone';
import { useToast } from '../../../components/ui/Toast';
import { fromLocalInput, toLocalInput } from '../../submissions/submissionStatus';
import { AUDIO_ACCEPT, DOCUMENT_ACCEPT, MATERIAL_TYPES, MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, formatDuration } from '../materialTypes';
import { parseVideoUrl, thumbnailUrl } from '../videoEmbed';
import AudioRecorder from './AudioRecorder';

/** Visibilidad en el formulario: borrador, publicar ya o programar. */
const VISIBILITY_OPTIONS = [
  { value: 'draft', label: 'Borrador', hint: 'Solo tú lo ves.' },
  { value: 'now', label: 'Publicar ahora', hint: 'Las familias lo ven de inmediato.' },
  { value: 'scheduled', label: 'Programar', hint: 'Se publica solo en la fecha y hora que elijas.' },
];

function initialVisibility(m) {
  if (!m?.visibility) return 'draft';
  return m.visibility.status === 'published' ? 'now' : m.visibility.status;
}

/**
 * Crear o editar un material de un tema. `initial` = material a editar o
 * { type } para crear uno nuevo de ese tipo (se puede cambiar de tipo).
 */
function MaterialEditorDrawer({ contentId, topicLabel, initial, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const toast = useToast();
  const [type, setType] = useState(initial?.type || 'file');
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    url: initial?.url || '',
    body: initial?.body || '',
    visibility: initialVisibility(initial),
    publishAt: toLocalInput(initial?.visibility?.publish_at),
  });
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(initial?.duration_seconds || null);
  const [progress, setProgress] = useState(0);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const video = useMemo(() => (type === 'video' && form.url ? parseVideoUrl(form.url) : null), [type, form.url]);
  const hasStoredFile = isEdit && initial.type === type && (type === 'file' || type === 'audio');

  const { run, loading, error, fieldErrors } = useMutation((data, f) =>
    isEdit ? learningApi.updateMaterial(initial.id, data, f, setProgress) : learningApi.createMaterial(contentId, data, f, setProgress)
  );

  const localError =
    !form.title.trim()
      ? null
      : type === 'video' && form.url && !video
        ? 'El enlace no es de YouTube ni de Vimeo.'
        : type === 'link' && form.url && !/^https:\/\//i.test(form.url.trim())
          ? 'El enlace debe empezar por https://'
          : form.visibility === 'scheduled' && !form.publishAt
            ? 'Elige la fecha y hora de publicación.'
            : null;
  const missing =
    !form.title.trim() ||
    ((type === 'file' || type === 'audio') && !file && !hasStoredFile) ||
    ((type === 'video' || type === 'link') && !form.url.trim()) ||
    (type === 'pill' && !form.body.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (missing || localError) return;
    const data = {
      type,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.visibility === 'draft' ? 'draft' : 'published',
      publishAt: form.visibility === 'scheduled' ? fromLocalInput(form.publishAt) : null,
      url: type === 'video' || type === 'link' ? form.url.trim() : null,
      body: type === 'pill' ? form.body.trim() : null,
      durationSeconds: type === 'audio' ? duration : null,
    };
    try {
      await run(data, type === 'file' || type === 'audio' ? file : null);
      toast.success(isEdit ? 'Material actualizado' : 'Material agregado', form.title.trim());
      onSaved();
      onClose();
    } catch {
      // visible en el panel
    }
  };

  // Al soltar un audio en "Guía", cambia a "Nota de voz" (y viceversa no aplica).
  const pickDocument = (f) => {
    setFile(f);
    if (f && !form.title.trim()) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, '').slice(0, 150) }));
  };

  return (
    <Drawer title={isEdit ? 'Editar material' : 'Nuevo material'} subtitle={topicLabel} icon={MATERIAL_TYPES[type].icon} onClose={onClose} busy={loading}>
      <Alert>{localError || error}</Alert>
      <form onSubmit={submit}>
        <div className="learn-typepicker" role="radiogroup" aria-label="Tipo de material">
          {Object.entries(MATERIAL_TYPES).map(([key, t]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={type === key}
              className={`learn-typepicker__opt learn-tone--${t.tone} ${type === key ? 'is-active' : ''}`}
              onClick={() => {
                setType(key);
                setFile(null);
              }}
            >
              <Icon name={t.icon} size={18} />
              {t.short}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <Field label="Título" error={fieldErrors.title} full>
            <Input value={form.title} onChange={set('title')} maxLength={150} required placeholder="Ej.: Guía de ejercicios del signo lingüístico" />
          </Field>

          {type === 'file' && (
            <Field label="Archivo" error={fieldErrors.file} full hint={hasStoredFile && !file ? `Actual: ${initial.file?.name}. Sube otro para reemplazarlo.` : undefined}>
              <FileDropzone
                value={file}
                onChange={pickDocument}
                accept={DOCUMENT_ACCEPT}
                maxBytes={MAX_DOCUMENT_BYTES}
                label="Arrastra la guía o presentación aquí"
                hint="PDF, imagen, Word, Excel o PowerPoint · máximo 25 MB"
                disabled={loading}
              />
            </Field>
          )}

          {type === 'audio' && (
            <Field label="Nota de voz" error={fieldErrors.file} full hint="Hasta 5 minutos. Graba aquí mismo o sube un archivo (MP3, M4A, OGG, WebM, WAV).">
              <div className="learn-audio-field">
                <AudioRecorder
                  disabled={loading}
                  onRecorded={(f, secs) => {
                    setFile(f);
                    setDuration(secs);
                  }}
                />
                <FileDropzone
                  value={file}
                  onChange={(f) => {
                    setFile(f);
                    setDuration(null);
                  }}
                  accept={AUDIO_ACCEPT}
                  maxBytes={MAX_AUDIO_BYTES}
                  label="O arrastra un audio"
                  disabled={loading}
                />
                {file && duration && <span className="text-sm text-muted">Duración: {formatDuration(duration)}</span>}
                {hasStoredFile && !file && <span className="text-sm text-muted">Actual: {initial.file?.name}</span>}
              </div>
            </Field>
          )}

          {(type === 'video' || type === 'link') && (
            <Field
              label={type === 'video' ? 'Enlace de YouTube o Vimeo' : 'Enlace'}
              error={fieldErrors.url}
              full
              hint={type === 'video' ? 'Se reproduce dentro de la plataforma.' : 'Se abre en una pestaña nueva (https://).'}
            >
              <Input value={form.url} onChange={set('url')} inputMode="url" placeholder={type === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://…'} required />
            </Field>
          )}
          {type === 'video' && video && (
            <div className="learn-video-preview">
              {thumbnailUrl(video) ? <img src={thumbnailUrl(video)} alt="" /> : <Icon name="video" size={28} />}
              <span className="text-sm">
                <Icon name="checkCircle" size={14} /> Video de {video.provider === 'youtube' ? 'YouTube' : 'Vimeo'} reconocido
              </span>
            </div>
          )}

          {type === 'pill' && (
            <Field label="Píldora de conocimiento" error={fieldErrors.body} full hint="Una idea clave, corta y fácil de recordar (máx. 1500 caracteres).">
              <textarea className="input" rows={5} maxLength={1500} value={form.body} onChange={set('body')} required placeholder="Ej.: El signo lingüístico une un significado (la idea) y un significante (la palabra)." />
            </Field>
          )}

          <Field label="Indicaciones" error={fieldErrors.description} full hint="Opcional: qué hacer con este material.">
            <textarea className="input" rows={2} maxLength={1000} value={form.description} onChange={set('description')} placeholder="Ej.: Resuelve los ejercicios 1 al 5 antes de la clase del jueves." />
          </Field>

          <Field label="Visibilidad" full>
            <div className="learn-visibility" role="radiogroup" aria-label="Visibilidad">
              {VISIBILITY_OPTIONS.map((o) => (
                <label key={o.value} className={`learn-visibility__opt ${form.visibility === o.value ? 'is-active' : ''}`}>
                  <input type="radio" name="visibility" value={o.value} checked={form.visibility === o.value} onChange={set('visibility')} />
                  <span>
                    <strong>{o.label}</strong>
                    <span className="text-sm text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          {form.visibility === 'scheduled' && (
            <Field label="Publicar el" error={fieldErrors.publishAt}>
              <Input type="datetime-local" value={form.publishAt} onChange={set('publishAt')} required />
            </Field>
          )}
        </div>

        {loading && file && progress > 0 && (
          <div className="task-upload-progress" aria-live="polite">
            <div className="task-upload-progress__bar" style={{ width: `${progress}%` }} />
            <span>Subiendo… {progress}%</span>
          </div>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={missing || Boolean(localError)}>
            {form.visibility === 'now' ? 'Guardar y publicar' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default MaterialEditorDrawer;
