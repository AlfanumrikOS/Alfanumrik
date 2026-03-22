'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

interface SimulationViewerProps {
  widgetCode: string;
  title: string;
  description?: string;
  simType?: string;
  onInteraction?: (data: { type: string; timestamp: number }) => void;
}

export default function SimulationViewer({ widgetCode, title, description, simType = 'interactive', onInteraction }: SimulationViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const buildIframeContent = useCallback(() => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Sora', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    padding: 16px;
    background: transparent;
    color: #1a1a1a;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  :root {
    --color-background-primary: #ffffff;
    --color-background-secondary: #f8f7f4;
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #666;
    --color-border-tertiary: rgba(0,0,0,0.1);
    --border-radius-md: 8px;
    --border-radius-lg: 12px;
    --font-sans: 'Sora', 'Plus Jakarta Sans', system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; }
    :root {
      --color-background-primary: #1a1a2e;
      --color-background-secondary: #16213e;
      --color-text-primary: #e5e5e5;
      --color-text-secondary: #a0a0a0;
      --color-border-tertiary: rgba(255,255,255,0.1);
    }
  }
  input[type=range] {
    -webkit-appearance: none; appearance: none;
    height: 6px; border-radius: 3px;
    background: #ddd; outline: none;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 18px; height: 18px; border-radius: 50%;
    background: #6366F1; cursor: pointer; border: 2px solid #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  button {
    font-family: inherit; font-size: 12px;
    padding: 6px 14px; border-radius: 8px;
    border: 1px solid #ddd; background: #fff;
    cursor: pointer; transition: all 0.15s;
    color: #333;
  }
  button:hover { background: #f0f0f0; transform: scale(1.02); }
  button:active { transform: scale(0.98); }
  canvas { display: block; }
</style>
</head>
<body>
${widgetCode}
<script>
  function notifyHeight() {
    const h = document.documentElement.scrollHeight;
    window.parent.postMessage({ type: 'sim-resize', height: h + 20 }, '*');
  }
  const ro = new ResizeObserver(notifyHeight);
  ro.observe(document.body);
  setTimeout(notifyHeight, 100);
  setTimeout(notifyHeight, 500);
  document.addEventListener('input', () => {
    window.parent.postMessage({ type: 'sim-interaction', action: 'input', ts: Date.now() }, '*');
  });
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      window.parent.postMessage({ type: 'sim-interaction', action: 'button', ts: Date.now() }, '*');
    }
  });
</script>
</body>
</html>`;
  }, [widgetCode]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'sim-resize' && iframeRef.current) {
        iframeRef.current.style.height = e.data.height + 'px';
      }
      if (e.data?.type === 'sim-interaction' && onInteraction) {
        onInteraction({ type: e.data.action, timestamp: e.data.ts });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onInteraction]);

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(buildIframeContent());
        doc.close();
        setIsLoaded(true);
      }
    }
  }, [widgetCode, buildIframeContent]);

  return (
    <div style={{
      borderRadius: '16px',
      overflow: 'hidden',
      border: '1px solid rgba(99,102,241,0.15)',
      background: 'var(--surface-1, #fff)',
      boxShadow: '0 2px 12px rgba(99,102,241,0.08)',
      transition: 'all 0.3s',
      ...(isExpanded ? { position: 'fixed' as const, inset: '16px', zIndex: 1000, maxWidth: '100%' } : {})
    }}>
      <div style={{
        padding: '12px 16px',
        background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🔬</span>
          <div>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>{title}</div>
            {description && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', marginTop: '2px' }}>{description}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            {isExpanded ? '✕ Close' : '⛶ Expand'}
          </button>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        {!isLoaded && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-2, #f8f7f4)',
            zIndex: 1
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🦊</div>
              <div style={{ color: 'var(--text-2, #666)', fontSize: '13px' }}>Loading simulation...</div>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          style={{
            width: '100%',
            minHeight: '400px',
            border: 'none',
            display: 'block',
            transition: 'height 0.2s'
          }}
          sandbox="allow-scripts allow-same-origin"
          title={title}
        />
      </div>
    </div>
  );
}
