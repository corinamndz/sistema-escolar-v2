import { useEffect, useRef, useState } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { MAX_AUDIO_SECONDS, formatDuration } from '../materialTypes';

/** Formato que el navegador sabe grabar (Chrome/Edge/Firefox: WebM u OGG con Opus; Safari: MP4/AAC). */
function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
  return typeof MediaRecorder !== 'undefined' ? options.find((t) => MediaRecorder.isTypeSupported?.(t)) || '' : '';
}
const extensionOf = (mime) => (mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm');

/**
 * Grabar una nota de voz explicativa en el navegador (hasta 5 minutos; se
 * detiene sola al llegar al límite). Entrega un File listo para subir y su
 * duración: onRecorded(file, seconds).
 */
function AudioRecorder({ onRecorded, disabled }) {
  const [state, setState] = useState('idle'); // idle | recording | denied | unsupported
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef(null);
  const timer = useRef(null);
  const started = useRef(0);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current?.stream?.getTracks().forEach((t) => t.stop());
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mime || 'audio/webm';
      const duration = Math.max(1, Math.round((Date.now() - started.current) / 1000));
      const file = new File([new Blob(chunks, { type })], `nota-de-voz.${extensionOf(type)}`, { type: type.split(';')[0] });
      setState('idle');
      onRecorded(file, Math.min(duration, MAX_AUDIO_SECONDS));
    };
    recorder.current = rec;
    started.current = Date.now();
    setSeconds(0);
    rec.start();
    setState('recording');
    timer.current = setInterval(() => {
      const s = Math.round((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= MAX_AUDIO_SECONDS) stop();
    }, 250);
  };

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  return (
    <div className="learn-recorder">
      {state === 'recording' ? (
        <>
          <span className="learn-recorder__dot" aria-hidden="true" />
          <span className="learn-recorder__time" aria-live="polite">
            Grabando {formatDuration(seconds) || '0:00'} / {formatDuration(MAX_AUDIO_SECONDS)}
          </span>
          <Button type="button" variant="danger" icon="square" onClick={stop}>
            Detener
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" icon="mic" onClick={start} disabled={disabled}>
          Grabar nota de voz
        </Button>
      )}
      {state === 'denied' && (
        <span className="field-error">
          <Icon name="alertCircle" size={14} /> No hay permiso para usar el micrófono. Actívalo en el navegador o sube un archivo de audio.
        </span>
      )}
      {state === 'unsupported' && <span className="text-sm text-muted">Este navegador no permite grabar: sube un archivo de audio.</span>}
    </div>
  );
}

export default AudioRecorder;
