import { useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { blobErrorMessage, fileNameFrom, saveBlob } from '../../../utils/download';
import { KIND_LABELS, MATERIAL_TYPES, formatDuration } from '../materialTypes';
import { embedUrl } from '../videoEmbed';

/**
 * Visor del material dentro de la plataforma (sin salir a otra pestaña):
 *   video  → reproductor embebido de YouTube / Vimeo
 *   file   → PDF con pdf.js; imagen; Office se descarga (el navegador no lo muestra)
 *   audio  → reproductor de audio
 *   pill   → texto de la píldora
 *   link   → vista previa y botón para abrir el sitio externo (no se puede embeber)
 *
 * `loadFile()` → Promise<{ blob, headers }> (docente o familia, según quién mira).
 * `footer`: acciones extra (p. ej. "¡Lo logré!" en el modo alumno).
 */
function MaterialViewer({ material: m, loadFile, onClose, footer = null }) {
  const type = MATERIAL_TYPES[m.type];
  const subtitle = [type?.label, m.kind && m.type === 'file' ? KIND_LABELS[m.kind] : null, formatDuration(m.duration_seconds)].filter(Boolean).join(' · ');
  return (
    <Drawer title={m.title} subtitle={subtitle} icon={type?.icon} onClose={onClose} size="lg">
      {m.description && <p className="learn-viewer__desc">{m.description}</p>}
      {m.type === 'video' && <VideoPlayer material={m} />}
      {m.type === 'pill' && <div className="learn-pill">{m.body}</div>}
      {m.type === 'link' && <LinkView material={m} />}
      {(m.type === 'file' || m.type === 'audio') && <FileView material={m} loadFile={loadFile} />}
      {footer && <div className="learn-viewer__footer">{footer}</div>}
    </Drawer>
  );
}

function VideoPlayer({ material }) {
  const src = embedUrl(material);
  if (!src) return <Alert>No se pudo cargar el video.</Alert>;
  return (
    <div className="learn-video">
      <iframe
        src={src}
        title={material.title}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function LinkView({ material }) {
  return (
    <div className="learn-link">
      <Icon name="externalLink" size={28} />
      <div>
        <div className="learn-link__domain">{material.domain}</div>
        <div className="text-sm text-muted">Este recurso está en otro sitio web y se abre en una pestaña nueva.</div>
      </div>
      <a className="btn btn--primary" href={material.url} target="_blank" rel="noopener noreferrer">
        <Icon name="externalLink" size={16} /> Abrir sitio
      </a>
    </div>
  );
}

/** Descarga el archivo (con la sesión) y lo muestra según su tipo. */
function FileView({ material: m, loadFile }) {
  const [state, setState] = useState({ loading: true, error: null, file: null });
  useEffect(() => {
    let cancelled = false;
    loadFile()
      .then((file) => !cancelled && setState({ loading: false, error: null, file }))
      .catch(async (err) => !cancelled && setState({ loading: false, error: await blobErrorMessage(err), file: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  if (state.loading) return <Spinner />;
  if (state.error) return <Alert>{state.error}</Alert>;
  const { blob, headers } = state.file;
  const name = fileNameFrom(headers, m.file?.name || 'material');
  const download = (
    <Button variant="secondary" icon="download" onClick={() => saveBlob(blob, name)}>
      Descargar
    </Button>
  );

  if (m.type === 'audio') return <BlobMedia blob={blob} kind="audio" title={m.title} extra={download} />;
  if (m.kind === 'pdf') return <PdfViewer blob={blob} extra={download} />;
  if (m.kind === 'image') return <BlobMedia blob={blob} kind="image" title={m.title} extra={download} />;
  return (
    <div className="learn-doc">
      <Icon name={m.kind === 'spreadsheet' ? 'spreadsheet' : 'file'} size={36} />
      <div>
        <strong>{name}</strong>
        <div className="text-sm text-muted">{KIND_LABELS[m.kind] || 'Documento'}: descárgalo para abrirlo con Word, Excel o PowerPoint.</div>
      </div>
      {download}
    </div>
  );
}

function BlobMedia({ blob, kind, title, extra }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return null;
  return (
    <div className="learn-media">
      {kind === 'audio' ? (
        <audio controls src={url} className="learn-media__audio">
          Tu navegador no puede reproducir este audio.
        </audio>
      ) : (
        <img src={url} alt={title} className="learn-media__img" />
      )}
      <div className="learn-media__actions">{extra}</div>
    </div>
  );
}

const MAX_PDF_PAGES = 60;

/** Visor de PDF con pdf.js (ya es dependencia del proyecto): páginas al ancho del panel y zoom. */
function PdfViewer({ blob, extra }) {
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [info, setInfo] = useState({ pages: 0, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        container.replaceChildren();
        const width = container.clientWidth - 2;
        const total = Math.min(doc.numPages, MAX_PDF_PAGES);
        setInfo({ pages: doc.numPages, loading: false, error: null });
        for (let n = 1; n <= total && !cancelled; n += 1) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * zoom * ratio });
          const canvas = document.createElement('canvas');
          canvas.className = 'learn-pdf__page';
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / ratio}px`;
          canvas.setAttribute('aria-label', `Página ${n} de ${doc.numPages}`);
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setInfo({ pages: 0, loading: false, error: 'No se pudo mostrar el PDF. Descárgalo para verlo.' });
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy?.();
    };
  }, [blob, zoom]);

  return (
    <div className="learn-pdf">
      <div className="learn-pdf__bar">
        <span className="text-sm text-muted">{info.pages ? `${info.pages} página(s)${info.pages > MAX_PDF_PAGES ? ` · se muestran ${MAX_PDF_PAGES}` : ''}` : ''}</span>
        <div className="learn-pdf__tools">
          <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} aria-label="Alejar" disabled={zoom <= 0.6}>
            −
          </Button>
          <span className="text-sm">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.min(2.4, Math.round((z + 0.2) * 10) / 10))} aria-label="Acercar" disabled={zoom >= 2.4}>
            +
          </Button>
          {extra}
        </div>
      </div>
      {info.loading && <Spinner />}
      {info.error && <Alert>{info.error}</Alert>}
      <div ref={containerRef} className="learn-pdf__pages" />
    </div>
  );
}

export default MaterialViewer;
