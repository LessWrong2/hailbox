// Rendered inside the widget's shadow root, so none of this leaks into (or is affected by) the host page.
export const widgetCss = /* css */ `
:host { all: initial; }

.hb {
  --hb-accent: #4f46e5;
  --hb-accent-fg: #ffffff;
  --hb-bg: #ffffff;
  --hb-fg: #111827;
  --hb-muted: #6b7280;
  --hb-bubble: #f1f2f6;
  --hb-border: #e5e7eb;
  --hb-input-bg: #ffffff;
  --hb-danger: #dc2626;
  --hb-shadow: 0 12px 40px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--hb-fg);
  -webkit-font-smoothing: antialiased;
}
:where(.hb) *, :where(.hb) *::before, :where(.hb) *::after { box-sizing: border-box; }

.hb[data-scheme="dark"] {
  --hb-bg: #16181d;
  --hb-fg: #f3f4f6;
  --hb-muted: #9ca3af;
  --hb-bubble: #262a33;
  --hb-border: #2f343e;
  --hb-input-bg: #1d2027;
  --hb-danger: #f87171;
  --hb-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
}
@media (prefers-color-scheme: dark) {
  .hb[data-scheme="auto"] {
    --hb-bg: #16181d;
    --hb-fg: #f3f4f6;
    --hb-muted: #9ca3af;
    --hb-bubble: #262a33;
    --hb-border: #2f343e;
    --hb-input-bg: #1d2027;
    --hb-danger: #f87171;
    --hb-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
  }
}

/* Zero-specificity resets, so component classes below always win. */
:where(.hb) button { font: inherit; color: inherit; cursor: pointer; }
.hb-launcher, .hb-panel, .hb-preview { z-index: var(--hb-z); }
.hb :focus-visible { outline: 2px solid var(--hb-accent); outline-offset: 2px; }

/* Launcher */
.hb-launcher {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  background: var(--hb-accent);
  color: var(--hb-accent-fg);
  box-shadow: var(--hb-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}
.hb-launcher:hover { transform: scale(1.06); }
.hb-launcher:active { transform: scale(0.96); }
.hb-launcher svg { width: 26px; height: 26px; }
.hb[data-position="left"] .hb-launcher { right: auto; left: 20px; }

.hb-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #ef4444;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--hb-bg);
}

/* Unread preview, shown next to the launcher when a reply arrived while the panel was closed */
.hb-preview {
  position: fixed;
  bottom: 88px;
  right: 20px;
  width: min(300px, calc(100vw - 40px));
  padding: 12px 36px 12px 14px;
  border: 1px solid var(--hb-border);
  border-radius: 14px;
  background: var(--hb-bg);
  box-shadow: var(--hb-shadow);
  text-align: left;
  animation: hb-pop 0.2s ease-out;
}
.hb[data-position="left"] .hb-preview { right: auto; left: 20px; }
.hb-preview-open { all: unset; display: block; width: 100%; cursor: pointer; }
.hb-preview-from { display: block; font-size: 12px; font-weight: 600; color: var(--hb-muted); margin-bottom: 2px; }
.hb-preview-body {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.hb-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--hb-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hb-preview-close:hover { background: var(--hb-bubble); }
.hb-preview-close svg { width: 14px; height: 14px; }

/* Panel */
.hb-panel {
  position: fixed;
  bottom: 88px;
  right: 20px;
  width: 370px;
  height: min(600px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: var(--hb-bg);
  box-shadow: var(--hb-shadow);
  animation: hb-pop 0.18s ease-out;
  transform-origin: bottom right;
}
.hb[data-position="left"] .hb-panel { right: auto; left: 20px; transform-origin: bottom left; }

@keyframes hb-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hb-panel, .hb-preview { animation: none; }
  .hb-launcher { transition: none; }
}

.hb-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 16px 16px 20px;
  background: var(--hb-accent);
  color: var(--hb-accent-fg);
}
.hb-header-text { flex: 1; min-width: 0; }
.hb-title { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.3; }
.hb-subtitle { margin: 4px 0 0; font-size: 13px; opacity: 0.85; }
.hb-close {
  flex: none;
  width: 32px;
  height: 32px;
  margin: -4px -4px 0 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hb-close:hover { background: rgba(255, 255, 255, 0.15); }
.hb-close svg { width: 18px; height: 18px; }

.hb-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.hb-group { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; }
.hb-group:first-child { margin-top: 0; }
.hb-group[data-author="visitor"] { align-items: flex-end; }
.hb-group[data-author="operator"] { align-items: flex-start; }
.hb-author { font-size: 12px; color: var(--hb-muted); margin: 0 0 1px 4px; }

.hb-bubble {
  max-width: 82%;
  padding: 8px 12px;
  border-radius: 16px;
  white-space: pre-wrap;
  word-break: break-word;
}
.hb-bubble a { color: inherit; text-decoration: underline; }
.hb-group[data-author="operator"] .hb-bubble { background: var(--hb-bubble); border-bottom-left-radius: 6px; }
.hb-group[data-author="visitor"] .hb-bubble {
  background: var(--hb-accent);
  color: var(--hb-accent-fg);
  border-bottom-right-radius: 6px;
}
.hb-bubble[data-status="sending"] { opacity: 0.7; }
.hb-bubble[data-status="failed"] { opacity: 0.6; }

.hb-meta { font-size: 11px; color: var(--hb-muted); margin: 1px 4px 0; }
.hb-failed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  padding: 0;
  background: none;
  font-size: 12px;
  color: var(--hb-danger);
}
.hb-failed:hover { text-decoration: underline; }

.hb-empty { margin: auto 0; padding: 24px 8px; text-align: center; color: var(--hb-muted); }

/* Email capture */
.hb-email {
  margin: 14px 0 4px;
  padding: 12px;
  border: 1px solid var(--hb-border);
  border-radius: 12px;
  background: var(--hb-bg);
}
.hb-email-title { margin: 0 0 2px; font-weight: 600; }
.hb-email-text { margin: 0 0 10px; font-size: 13px; color: var(--hb-muted); }
.hb-email-row { display: flex; gap: 8px; }
.hb-email input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--hb-border);
  border-radius: 8px;
  background: var(--hb-input-bg);
  color: var(--hb-fg);
  font: inherit;
}
.hb-email input:focus { outline: none; border-color: var(--hb-accent); }
.hb-email-error { margin: 6px 0 0; font-size: 12px; color: var(--hb-danger); }
.hb-button {
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: var(--hb-accent);
  color: var(--hb-accent-fg);
  font-weight: 600;
}
.hb-button:disabled { opacity: 0.6; cursor: default; }
.hb-link {
  border: none;
  padding: 0;
  background: none;
  color: var(--hb-muted);
  font-size: 12px;
  text-decoration: underline;
}
.hb-email-actions { margin-top: 8px; }
.hb-notice { margin: 10px 0 2px; text-align: center; font-size: 12px; color: var(--hb-muted); }

/* Composer */
.hb-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--hb-border);
}
.hb-composer textarea {
  flex: 1;
  min-height: 40px;
  max-height: 140px;
  padding: 9px 12px;
  border: 1px solid var(--hb-border);
  border-radius: 12px;
  background: var(--hb-input-bg);
  color: var(--hb-fg);
  font: inherit;
  resize: none;
  overflow-y: auto;
}
.hb-composer textarea:focus { outline: none; border-color: var(--hb-accent); }
.hb-composer textarea::placeholder { color: var(--hb-muted); }
.hb-send {
  flex: none;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 12px;
  background: var(--hb-accent);
  color: var(--hb-accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hb-send:disabled { opacity: 0.4; cursor: default; }
.hb-send svg { width: 18px; height: 18px; }

.hb-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 480px) {
  .hb-panel, .hb[data-position="left"] .hb-panel {
    inset: 0;
    width: auto;
    height: auto;
    border-radius: 0;
  }
  .hb[data-open="true"] .hb-launcher { display: none; }
  /* iOS zooms into inputs smaller than 16px when they're focused. */
  .hb-composer textarea, .hb-email input { font-size: 16px; }
}
`;
