'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, Button, Badge } from '@/components/ui';

/* ─── Types ─── */
export interface ScanSolverProps {
  studentId: string;
  grade: string;
  subject?: string;
  isHi: boolean;
  onSolveComplete?: (result: ScanSolveResult) => void;
}

export type ScanSolverState =
  | 'idle'
  | 'capturing'
  | 'preview'
  | 'processing-ocr'
  | 'processing-solve'
  | 'result'
  | 'error';

export interface ScanSolveResult {
  scan_id: string;
  status: string;
  extracted_text: string | null;
  solution: {
    answer: string;
    steps: string[];
    explanation: string;
    concept: string;
    common_mistake: string;
    formula_used: string;
    confidence: number;
    verified: boolean;
    question_type: string;
    subject: string;
    topic: string;
  } | null;
  solve_error: string | null;
  remaining_scans: number;
}

/* ─── i18n ─── */
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

/* ─── Component ─── */
export default function ScanSolver({ studentId, grade, subject, isHi, onSolveComplete }: ScanSolverProps) {
  const [state, setState] = useState<ScanSolverState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanSolveResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Check camera availability ──
  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
      setCameraAvailable(true);
    } else {
      setCameraAvailable(false);
    }
  }, []);

  // ── Cleanup camera stream on unmount ──
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // ── Start camera ──
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setCameraStream(stream);
      setState('capturing');
      // Attach stream to video after state update
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((err: unknown) => {
            console.warn('[scan] video play failed:', err instanceof Error ? err.message : String(err));
          });
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setErrorMessage(t(isHi, 'Camera permission denied. Please allow camera access or upload a file.', 'Camera ki permission nahi mili. Camera allow karein ya file upload karein.'));
      } else {
        setErrorMessage(t(isHi, 'Could not access camera. Try uploading a file instead.', 'Camera access nahi ho paaya. File upload karein.'));
      }
      setState('error');
    }
  }, [isHi, cameraStream]);

  // ── Capture photo from camera ──
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Stop camera
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }

    canvas.toBlob(
      blob => {
        if (!blob) {
          setErrorMessage(t(isHi, 'Failed to capture image', 'Image capture fail ho gayi'));
          setState('error');
          return;
        }
        const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
        setCapturedFile(file);
        setPreviewUrl(canvas.toDataURL('image/jpeg', 0.85));
        setState('preview');
      },
      'image/jpeg',
      0.85,
    );
  }, [cameraStream, isHi]);

  // ── Handle file upload ──
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      if (!file.type.startsWith('image/')) {
        setErrorMessage(t(isHi, 'Please select an image file', 'Ek image file chunein'));
        setState('error');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setErrorMessage(t(isHi, 'Image must be under 5MB', 'Image 5MB se chhoti honi chahiye'));
        setState('error');
        return;
      }

      setCapturedFile(file);
      const reader = new FileReader();
      reader.onload = ev => {
        setPreviewUrl(ev.target?.result as string);
        setState('preview');
      };
      reader.readAsDataURL(file);
    },
    [isHi],
  );

  // ── Solve: send image to API ──
  const solve = useCallback(async () => {
    if (!capturedFile) return;

    setState('processing-ocr');
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('image', capturedFile);
      if (subject) formData.append('subject', subject);
      formData.append('grade', grade);

      const response = await fetch('/api/scan-solve', {
        method: 'POST',
        headers: {
          'x-lang': isHi ? 'hi' : 'en',
        },
        body: formData,
      });

      const data: ScanSolveResult = await response.json();

      if (!response.ok) {
        // Rate limit or server error
        const errMsg = (data as any).error || t(isHi, 'Something went wrong', 'Kuch galat ho gaya');
        setErrorMessage(errMsg);
        setState('error');
        return;
      }

      if (data.status === 'ocr_failed') {
        setErrorMessage(
          (data as any).error ||
            t(isHi, 'Could not read text from this image. Please try a clearer photo.', 'Is image se text nahi padh paaye. Saaf photo try karein.'),
        );
        setState('error');
        return;
      }

      // OCR succeeded — now show solve progress
      if (data.extracted_text && !data.solution) {
        setState('processing-solve');
        // Result came back without solution (ocr_only)
      }

      setResult(data);
      setState('result');
      onSolveComplete?.(data);
    } catch (err) {
      setErrorMessage(t(isHi, 'Network error. Please check your connection.', 'Network error. Connection check karein.'));
      setState('error');
    }
  }, [capturedFile, subject, grade, isHi, onSolveComplete]);

  // ── Reset ──
  const reset = useCallback(() => {
    setState('idle');
    setPreviewUrl(null);
    setCapturedFile(null);
    setResult(null);
    setErrorMessage('');
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  // ── Cancel camera ──
  const cancelCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setState('idle');
  }, [cameraStream]);

  /* ═══ RENDER ═══ */

  // ── IDLE: Show capture options ──
  if (state === 'idle') {
    return (
      <div className="space-y-4">
        <div
          className="rounded-2xl p-8 text-center cursor-pointer transition-all"
          style={{ background: 'var(--surface-1)', border: '2px dashed var(--border)' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-5xl mb-3">📷</div>
          <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {t(isHi, 'Scan & Solve', 'स्कैन और हल करो')}
          </h3>
          <p className="text-xs text-[var(--text-3)] mb-4">
            {t(isHi, 'Take a photo of your textbook question or upload an image', 'अपनी किताब के सवाल की फ़ोटो लो या इमेज अपलोड करो')}
          </p>
          <div className="flex justify-center gap-3">
            {cameraAvailable && (
              <Button
                size="sm"
                variant="soft"
                color="var(--orange)"
                onClick={e => {
                  e.stopPropagation();
                  startCamera();
                }}
              >
                {t(isHi, 'Open Camera', 'कैमरा खोलो')}
              </Button>
            )}
            <Button
              size="sm"
              variant="soft"
              color="#0891B2"
              onClick={e => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              {t(isHi, 'Upload Image', 'इमेज अपलोड करो')}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>
    );
  }

  // ── CAPTURING: Camera live view ──
  if (state === 'capturing') {
    return (
      <div className="space-y-3">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: '#000' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-64 object-cover"
          />
          {/* Viewfinder overlay */}
          <div
            className="absolute inset-4 rounded-xl pointer-events-none"
            style={{ border: '2px solid rgba(255,255,255,0.4)' }}
          />
          <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/70">
            {t(isHi, 'Position the question in the frame', 'सवाल को फ्रेम में रखें')}
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Button size="sm" variant="soft" color="#EF4444" onClick={cancelCamera}>
            {t(isHi, 'Cancel', 'रद्द करो')}
          </Button>
          <Button size="sm" color="var(--orange)" onClick={capturePhoto}>
            {t(isHi, 'Capture', 'फ़ोटो लो')}
          </Button>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // ── PREVIEW: Show captured image, confirm solve ──
  if (state === 'preview') {
    return (
      <div className="space-y-3">
        {previewUrl && (
          <div className="rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Captured question" className="w-full h-48 object-contain" style={{ background: 'var(--surface-2)' }} />
          </div>
        )}
        <div className="flex justify-center gap-3">
          <Button size="sm" variant="soft" color="var(--text-3)" onClick={reset}>
            {t(isHi, 'Retake', 'दोबारा लो')}
          </Button>
          <Button size="sm" color="var(--orange)" onClick={solve}>
            {t(isHi, 'Solve This', 'इसे हल करो')}
          </Button>
        </div>
      </div>
    );
  }

  // ── PROCESSING: OCR or Solve in progress ──
  if (state === 'processing-ocr' || state === 'processing-solve') {
    const isOcr = state === 'processing-ocr';
    return (
      <div className="text-center py-12">
        {previewUrl && (
          <div className="w-28 h-28 mx-auto rounded-xl overflow-hidden mb-4 border" style={{ borderColor: 'var(--border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Processing" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="text-4xl animate-float mb-3">{isOcr ? '🔍' : '🧮'}</div>
        <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
          {isOcr
            ? t(isHi, 'Foxy is reading the question...', 'Foxy सवाल पढ़ रहा है...')
            : t(isHi, 'Foxy is solving...', 'Foxy हल कर रहा है...')}
        </p>
        <p className="text-xs text-[var(--text-3)] mt-1">
          {t(isHi, 'This may take a few seconds', 'कुछ सेकंड लग सकते हैं')}
        </p>
        <div className="flex justify-center gap-2 mt-4">
          {(isOcr
            ? ['Reading text', 'Detecting question']
            : ['Finding solution', 'Verifying answer']
          ).map((step, i) => (
            <span key={i} className="text-[10px] px-2 py-1 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              {step}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── ERROR ──
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <Card accent="#EF4444">
          <div className="flex items-start gap-2">
            <span className="text-lg flex-shrink-0">&#9888;&#65039;</span>
            <div>
              <p className="text-xs text-[#EF4444] font-medium">{errorMessage}</p>
            </div>
          </div>
        </Card>
        <div className="flex justify-center gap-3">
          <Button size="sm" variant="soft" color="#EF4444" onClick={reset}>
            {t(isHi, 'Try Again', 'फिर कोशिश करें')}
          </Button>
          {previewUrl && (
            <Button
              size="sm"
              variant="soft"
              color="var(--orange)"
              onClick={() => {
                // Redirect to Foxy with what we have
                const query = result?.extracted_text
                  ? `?question=${encodeURIComponent(result.extracted_text)}`
                  : '';
                window.location.href = `/foxy${query}`;
              }}
            >
              {t(isHi, 'Ask Foxy Instead', 'Foxy से पूछो')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── RESULT: Show solution ──
  if (state === 'result' && result) {
    return (
      <div className="space-y-3">
        {/* Extracted text */}
        <Card>
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
              {t(isHi, 'Detected Question', 'पहचाना गया सवाल')}
            </p>
            <p className="text-sm text-[var(--text-1)]">{result.extracted_text}</p>
          </div>
          {result.solution && (
            <div className="flex items-center gap-2">
              <Badge
                color={result.solution.confidence >= 0.8 ? '#16A34A' : result.solution.confidence >= 0.6 ? '#F59E0B' : '#EF4444'}
                size="sm"
              >
                {Math.round(result.solution.confidence * 100)}% {t(isHi, 'confidence', 'विश्वास')}
              </Badge>
              {result.solution.verified && (
                <Badge color="#16A34A" size="sm">
                  {t(isHi, 'Verified', 'सत्यापित')}
                </Badge>
              )}
              {result.solution.question_type && (
                <Badge color="var(--teal, #0891B2)" size="sm">
                  {result.solution.question_type}
                </Badge>
              )}
            </div>
          )}
        </Card>

        {/* Solution */}
        {result.solution ? (
          <>
            {/* Answer */}
            <Card accent="var(--orange)">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                {t(isHi, 'Answer', 'उत्तर')}
              </p>
              <p className="text-sm font-semibold text-[var(--text-1)]">{result.solution.answer}</p>
            </Card>

            {/* Steps */}
            {result.solution.steps.length > 0 && (
              <Card>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-2">
                  {t(isHi, 'Step-by-Step Solution', 'कदम-दर-कदम हल')}
                </p>
                <ol className="space-y-2">
                  {result.solution.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-[var(--text-1)]">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}
                      >
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            {/* Explanation */}
            {result.solution.explanation && (
              <Card>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                  {t(isHi, 'Explanation', 'व्याख्या')}
                </p>
                <p className="text-xs text-[var(--text-2)] leading-relaxed">{result.solution.explanation}</p>
              </Card>
            )}

            {/* Formula & Common Mistake */}
            {(result.solution.formula_used || result.solution.common_mistake) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {result.solution.formula_used && (
                  <Card accent="#7C3AED">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                      {t(isHi, 'Formula Used', 'प्रयुक्त सूत्र')}
                    </p>
                    <p className="text-xs text-[var(--text-1)] font-mono">{result.solution.formula_used}</p>
                  </Card>
                )}
                {result.solution.common_mistake && (
                  <Card accent="#EF4444">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                      {t(isHi, 'Common Mistake', 'आम गलती')}
                    </p>
                    <p className="text-xs text-[var(--text-2)]">{result.solution.common_mistake}</p>
                  </Card>
                )}
              </div>
            )}

            {/* Concept */}
            {result.solution.concept && (
              <Card>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                  {t(isHi, 'Concept', 'अवधारणा')}
                </p>
                <p className="text-xs text-[var(--text-2)]">{result.solution.concept}</p>
              </Card>
            )}
          </>
        ) : (
          /* Solve error — show extracted text with fallback */
          <Card accent="#F59E0B">
            <p className="text-xs text-[var(--text-2)] mb-2">
              {result.solve_error || t(isHi, 'Could not solve this question automatically.', 'यह सवाल अपने-आप हल नहीं हो पाया।')}
            </p>
            <Button
              size="sm"
              variant="soft"
              color="var(--orange)"
              onClick={() => {
                const query = result.extracted_text
                  ? `?question=${encodeURIComponent(result.extracted_text)}`
                  : '';
                window.location.href = `/foxy${query}`;
              }}
            >
              {t(isHi, 'Ask Foxy Instead', 'Foxy से पूछो')}
            </Button>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-between items-center pt-2">
          <Button size="sm" variant="soft" color="var(--text-3)" onClick={reset}>
            {t(isHi, 'Scan Another', 'और स्कैन करो')}
          </Button>
          {result.remaining_scans !== undefined && (
            <span className="text-[10px] text-[var(--text-3)]">
              {result.remaining_scans} {t(isHi, 'scans remaining today', 'स्कैन आज बाकी')}
            </span>
          )}
        </div>
      </div>
    );
  }

  return null;
}
