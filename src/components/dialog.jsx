import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// App-styled replacement for window.alert / window.confirm.
// Usage: const { alert, confirm } = useDialog();
//   alert('message') -> Promise (OK button)
//   confirm('message', { title, okLabel, cancelLabel, danger }) -> Promise<bool>
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

let nextId = 0;

export function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  // Ref mirror so close() can resolve outside the state updater
  // (side effects inside updaters break under StrictMode double-invoke).
  const queueRef = useRef([]);

  const show = useCallback((kind, message, opts) => new Promise((resolve) => {
    const id = ++nextId;
    queueRef.current = [...queueRef.current, { id, kind, message, opts: opts || {}, resolve }];
    setQueue(queueRef.current);
  }), []);

  const alert = useCallback((message, opts) => show('alert', message, opts), [show]);
  const confirm = useCallback((message, opts) => show('confirm', message, opts), [show]);

  const close = useCallback((id, value) => {
    const item = queueRef.current.find((d) => d.id === id);
    queueRef.current = queueRef.current.filter((d) => d.id !== id);
    setQueue(queueRef.current);
    if (item) item.resolve(value);
  }, []);

  const current = queue[0] || null;

  useEffect(() => {
    if (!current) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close(current.id, current.kind === 'alert');
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(current.id, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, close]);

  const okLabel = current?.opts.okLabel || 'OK';
  const cancelLabel = current?.opts.cancelLabel || 'Cancel';

  return (
    <DialogCtx.Provider value={{ alert, confirm }}>
      {children}
      {current && (
        <div
          className="dlg-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) close(current.id, current.kind === 'alert'); }}
        >
          <div className="dlg-modal" role="alertdialog" aria-modal="true">
            <div className="dlg-hdr">{current.opts.title || 'CaptionManager'}</div>
            <div className="dlg-body">{current.message}</div>
            <div className="dlg-ftr">
              {current.kind === 'confirm' && (
                <button className="btn btn-ghost" onClick={() => close(current.id, false)} autoFocus={!current.opts.danger}>
                  {cancelLabel}
                </button>
              )}
              <button
                className={`btn ${current.opts.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(current.id, true)}
                autoFocus={current.kind === 'alert' || !!current.opts.danger}
              >
                {okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogCtx.Provider>
  );
}
