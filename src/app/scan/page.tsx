'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, SectionHeader, LoadingFoxy, BottomNav, Badge } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

/* ─── Types ─── */
interface ExtractedQuestion {
  id: string;
  text: string;
  topic: string;
  confidence: number;
}

interface ScanResult {
  subject: string;
  chapter: string;
  questions: ExtractedQuestion[];
  topics: Array<{ name: string; confidence: number }>;
}

interface ImageUpload {
  id: string;
  student_id: string;
  image_url: string;
  image_type: string;
  processing_status: string;
  detected_subject: string | null;
  detected_chapter: string | null;
  created_at: string;
}

/* ─── Constants ─── */
const IMAGE_TYPES = [
  { id: 'assignment', label: 'Assignment', labelHi: 'असाइनमेंट', icon: '📝' },
  { id: 'question_paper', label: 'Question Paper', labelHi: 'प्रश्नपत्र', icon: '📋' },
  { id: 'notes', label: 'Notes', labelHi: 'नोट्स', icon: '📖' },
  { id: 'textbook', label: 'Textbook', labelHi: 'पाठ्यपुस्तक', icon: '📚' },
];

type ProcessingState = 'idle' | 'uploading' | 'processing' | 'results' | 'error';

export default function ScanPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [selectedType, setSelectedType] = useState<string>('assignment');
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Recent uploads
  const [recentUploads, setRecentUploads] = useState<ImageUpload[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* ─── Load recent uploads ─── */
  const loadRecent = useCallback(async () => {
    if (!student) return;
    setLoadingRecent(true);
    try {
      const { data, error } = await supabase
        .from('image_uploads')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!error && data) setRecentUploads(data as ImageUpload[]);
    } catch (e) {
      console.error('Load recent uploads error:', e);
    }
    setLoadingRecent(false);
  }, [student]);

  useEffect(() => {
    if (student) loadRecent();
  }, [student, loadRecent]);

  /* ─── Simulate OCR processing ─── */
  const simulateOCR = useCallback((imageType: string): ScanResult => {
    // Simulated OCR results based on image type
    const mockResults: Record<string, ScanResult> = {
      assignment: {
        subject: 'math',
        chapter: 'Linear Equations',
        questions: [
          { id: '1', text: 'Solve: 3x + 5 = 20', topic: 'Linear Equations in One Variable', confidence: 0.92 },
          { id: '2', text: 'Find the value of y if 2y - 7 = 15', topic: 'Linear Equations in One Variable', confidence: 0.88 },
          { id: '3', text: 'The sum of two numbers is 25. If one number is 7 more than the other, find the numbers.', topic: 'Word Problems', confidence: 0.85 },
        ],
        topics: [
          { name: 'Linear Equations in One Variable', confidence: 0.94 },
          { name: 'Word Problems on Linear Equations', confidence: 0.82 },
        ],
      },
      question_paper: {
        subject: 'science',
        chapter: 'Force and Pressure',
        questions: [
          { id: '1', text: 'Define force. What are the effects of force?', topic: 'Force and Pressure', confidence: 0.95 },
          { id: '2', text: 'Differentiate between contact and non-contact forces with examples.', topic: 'Types of Forces', confidence: 0.91 },
          { id: '3', text: 'What is pressure? Derive the formula P = F/A.', topic: 'Pressure', confidence: 0.89 },
          { id: '4', text: 'Explain atmospheric pressure with an example.', topic: 'Atmospheric Pressure', confidence: 0.87 },
        ],
        topics: [
          { name: 'Force and Pressure', confidence: 0.96 },
          { name: 'Types of Forces', confidence: 0.88 },
          { name: 'Atmospheric Pressure', confidence: 0.84 },
        ],
      },
      notes: {
        subject: 'english',
        chapter: 'Grammar - Tenses',
        questions: [
          { id: '1', text: 'Convert to past tense: She writes a letter every day.', topic: 'Tenses', confidence: 0.90 },
          { id: '2', text: 'Identify the tense: They had been playing for two hours.', topic: 'Perfect Continuous Tense', confidence: 0.86 },
        ],
        topics: [
          { name: 'Simple Tenses', confidence: 0.92 },
          { name: 'Perfect Continuous Tense', confidence: 0.80 },
        ],
      },
      textbook: {
        subject: 'math',
        chapter: 'Mensuration',
        questions: [
          { id: '1', text: 'Find the area of a trapezium with parallel sides 12 cm and 8 cm, and height 5 cm.', topic: 'Area of Trapezium', confidence: 0.93 },
          { id: '2', text: 'Calculate the surface area of a cube with side 6 cm.', topic: 'Surface Area', confidence: 0.91 },
        ],
        topics: [
          { name: 'Area of Quadrilaterals', confidence: 0.90 },
          { name: 'Surface Area and Volume', confidence: 0.85 },
        ],
      },
    };
    return mockResults[imageType] || mockResults.assignment;
  }, []);

  /* ─── Handle file upload ─── */
  const handleFile = async (file: File) => {
    if (!student || !file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage(isHi ? 'कृपया एक इमेज फ़ाइल चुनें' : 'Please select an image file');
      setProcessingState('error');
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = e => setPreviewUrl(e.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    setProcessingState('uploading');
    setErrorMessage('');
    setScanResult(null);

    try {
      const path = `${student.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('uploads').upload(path, file);

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        setErrorMessage(isHi ? 'अपलोड में त्रुटि' : 'Upload failed');
        setProcessingState('error');
        return;
      }

      const url = supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl;

      // Save to DB
      await supabase.from('image_uploads').insert({
        student_id: student.id,
        image_url: url,
        image_type: selectedType,
        processing_status: 'pending',
      });

      // Simulate processing
      setProcessingState('processing');

      setTimeout(() => {
        const result = simulateOCR(selectedType);
        setScanResult(result);
        setProcessingState('results');

        // Update DB status
        supabase
          .from('image_uploads')
          .update({
            processing_status: 'completed',
            detected_subject: result.subject,
            detected_chapter: result.chapter,
          })
          .eq('student_id', student.id)
          .eq('image_url', url)
          .then(() => loadRecent());
      }, 2000);
    } catch (e) {
      console.error('File handling error:', e);
      setErrorMessage(isHi ? 'फ़ाइल प्रोसेसिंग में त्रुटि' : 'Error processing file');
      setProcessingState('error');
    }
  };

  /* ─── Drag and Drop handlers ─── */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  /* ─── Reset ─── */
  const handleReset = () => {
    setProcessingState('idle');
    setPreviewUrl(null);
    setScanResult(null);
    setErrorMessage('');
  };

  const getSubjectMeta = (code: string) => SUBJECT_META.find(s => s.code === code);

  if (isLoading || !student) return <LoadingFoxy />;

  /* ═══ RENDER ═══ */
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'स्कैन और सीखो' : 'Scan & Learn'}
            </h1>
          </div>
          {processingState === 'results' && (
            <button
              onClick={handleReset}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              {isHi ? 'नया स्कैन' : 'New Scan'}
            </button>
          )}
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <SectionErrorBoundary section="Scan">
        {/* ═══ UPLOAD AREA ═══ */}
        {(processingState === 'idle' || processingState === 'error') && (
          <>
            {/* Image Type Selector */}
            <div>
              <p className="text-xs text-[var(--text-3)] mb-2 font-medium">
                {isHi ? 'इमेज का प्रकार' : 'Image Type'}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {IMAGE_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedType(t.id)}
                    className="rounded-xl p-2.5 text-center transition-all"
                    style={{
                      background: selectedType === t.id ? 'rgba(232,88,28,0.1)' : 'var(--surface-1)',
                      border: selectedType === t.id ? '2px solid var(--orange)' : '1.5px solid var(--border)',
                    }}
                  >
                    <div className="text-lg mb-0.5">{t.icon}</div>
                    <div className="text-[10px] font-semibold" style={{ color: selectedType === t.id ? 'var(--orange)' : 'var(--text-3)' }}>
                      {isHi ? t.labelHi : t.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl p-8 text-center cursor-pointer transition-all"
              style={{
                background: isDragging ? 'rgba(232,88,28,0.08)' : 'var(--surface-1)',
                border: isDragging ? '2px dashed var(--orange)' : '2px dashed var(--border)',
              }}
            >
              <div className="text-5xl mb-3">{isDragging ? '📥' : '📷'}</div>
              <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                {isDragging
                  ? (isHi ? 'यहाँ छोड़ें' : 'Drop here')
                  : (isHi ? 'इमेज अपलोड करें' : 'Upload Image')}
              </h3>
              <p className="text-xs text-[var(--text-3)] mb-3">
                {isHi
                  ? 'खींचकर छोड़ें या क्लिक करें'
                  : 'Drag & drop or click to browse'}
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  size="sm"
                  variant="soft"
                  color="var(--orange)"
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  {isHi ? '📁 फ़ाइल चुनें' : '📁 Choose File'}
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  color="#0891B2"
                  onClick={e => {
                    e.stopPropagation();
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                      fileInputRef.current.removeAttribute('capture');
                    }
                  }}
                >
                  {isHi ? '📸 कैमरा' : '📸 Camera'}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>

            {/* Error message */}
            {processingState === 'error' && errorMessage && (
              <Card accent="#EF4444">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚠️</span>
                  <p className="text-xs text-[#EF4444] font-medium">{errorMessage}</p>
                </div>
                <Button size="sm" variant="soft" color="#EF4444" onClick={handleReset} className="mt-2">
                  {isHi ? 'फिर कोशिश करें' : 'Try Again'}
                </Button>
              </Card>
            )}
          </>
        )}

        {/* ═══ UPLOADING STATE ═══ */}
        {processingState === 'uploading' && (
          <div className="text-center py-16">
            <div className="text-4xl animate-float mb-3">📤</div>
            <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'अपलोड हो रहा है...' : 'Uploading...'}
            </p>
            <p className="text-xs text-[var(--text-3)] mt-1">
              {isHi ? 'कृपया प्रतीक्षा करें' : 'Please wait'}
            </p>
          </div>
        )}

        {/* ═══ PROCESSING STATE ═══ */}
        {processingState === 'processing' && (
          <div className="text-center py-16">
            {previewUrl && (
              <div className="w-32 h-32 mx-auto rounded-xl overflow-hidden mb-4 border" style={{ borderColor: 'var(--border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Uploaded document preview" width={128} height={128} loading="lazy" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="text-4xl animate-float mb-3">🔍</div>
            <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'प्रोसेसिंग हो रही है...' : 'Processing...'}
            </p>
            <p className="text-xs text-[var(--text-3)] mt-1">
              {isHi ? 'AI इमेज का विश्लेषण कर रहा है' : 'AI is analyzing the image'}
            </p>
            <div className="flex justify-center gap-3 mt-4">
              {['Detecting text', 'Identifying subject', 'Mapping syllabus'].map((step, i) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                  {step}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ═══ RESULTS ═══ */}
        {processingState === 'results' && scanResult && (
          <>
            {/* Preview */}
            {previewUrl && (
              <div className="w-full h-40 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Scanned document preview" width={400} height={160} loading="lazy" className="w-full h-full object-cover" />
              </div>
            )}

            {/* Detected Subject & Chapter */}
            <Card accent={getSubjectMeta(scanResult.subject)?.color || 'var(--orange)'}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{getSubjectMeta(scanResult.subject)?.icon || '📚'}</span>
                <div>
                  <p className="text-xs text-[var(--text-3)]">{isHi ? 'पहचाना गया विषय' : 'Detected Subject'}</p>
                  <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                    {getSubjectMeta(scanResult.subject)?.name || scanResult.subject}
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">{scanResult.chapter}</p>
                </div>
              </div>
            </Card>

            {/* Extracted Questions */}
            <SectionHeader icon="📝">
              {isHi ? `${scanResult.questions.length} प्रश्न पहचाने गए` : `${scanResult.questions.length} Questions Detected`}
            </SectionHeader>

            {scanResult.questions.map((q, idx) => (
              <Card key={q.id}>
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                    Q{idx + 1}
                  </span>
                  <p className="text-sm text-[var(--text-1)]">{q.text}</p>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <Badge color="var(--teal, #0891B2)" size="sm">{q.topic}</Badge>
                  <span className="text-[10px] text-[var(--text-3)]">{Math.round(q.confidence * 100)}% match</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => router.push(`/foxy?question=${encodeURIComponent(q.text)}`)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ background: 'rgba(232,88,28,0.1)', border: '1px solid rgba(232,88,28,0.2)', color: 'var(--orange)' }}
                  >
                    🦊 {isHi ? 'हल करो' : 'Solve Step-by-Step'}
                  </button>
                  <button
                    onClick={() => router.push(`/quiz?topic=${encodeURIComponent(q.topic)}`)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#7C3AED' }}
                  >
                    {isHi ? 'समान प्रश्न' : 'Similar Questions'}
                  </button>
                  <button
                    onClick={() => router.push(`/study-plan?add_topic=${encodeURIComponent(q.topic)}`)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', color: '#0891B2' }}
                  >
                    {isHi ? 'प्लान में जोड़ो' : 'Add to Plan'}
                  </button>
                </div>
              </Card>
            ))}

            {/* Mapped Syllabus Topics */}
            <SectionHeader icon="🎯">
              {isHi ? 'पाठ्यक्रम विषय' : 'Mapped Syllabus Topics'}
            </SectionHeader>

            <Card>
              <div className="space-y-3">
                {scanResult.topics.map((topic, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-1)] flex-1">{topic.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${topic.confidence * 100}%`, background: topic.confidence > 0.9 ? '#16A34A' : topic.confidence > 0.8 ? '#F59E0B' : '#EF4444' }}
                        />
                      </div>
                      <span className="text-[10px] text-[var(--text-3)] w-8 text-right">
                        {Math.round(topic.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ═══ RECENT SCANS ═══ */}
        {processingState === 'idle' && (
          <>
            <SectionHeader icon="🕐">
              {isHi ? 'हाल के स्कैन' : 'Recent Scans'}
            </SectionHeader>

            {loadingRecent ? (
              <p className="text-xs text-[var(--text-3)] text-center py-4">
                {isHi ? 'लोड हो रहा है...' : 'Loading...'}
              </p>
            ) : recentUploads.length === 0 ? (
              <Card>
                <div className="text-center py-6">
                  <div className="text-3xl mb-2">📷</div>
                  <p className="text-xs text-[var(--text-3)]">
                    {isHi ? 'अभी तक कोई स्कैन नहीं' : 'No scans yet'}
                  </p>
                </div>
              </Card>
            ) : (
              <div className="space-y-2">
                {recentUploads.map(upload => {
                  const subMeta = upload.detected_subject ? getSubjectMeta(upload.detected_subject) : null;
                  const typeConfig = IMAGE_TYPES.find(t => t.id === upload.image_type);
                  return (
                    <Card key={upload.id} hoverable>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border" style={{ borderColor: 'var(--border)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={upload.image_url} alt={`Scanned ${upload.image_type || 'document'}`} width={48} height={48} loading="lazy" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate">
                              {typeConfig?.icon} {isHi ? typeConfig?.labelHi : typeConfig?.label}
                            </span>
                            <Badge
                              size="sm"
                              color={upload.processing_status === 'completed' ? '#16A34A' : upload.processing_status === 'pending' ? '#F59E0B' : '#EF4444'}
                            >
                              {upload.processing_status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {subMeta && (
                              <span className="text-[10px] text-[var(--text-3)]">
                                {subMeta.icon} {subMeta.name}
                              </span>
                            )}
                            {upload.detected_chapter && (
                              <span className="text-[10px] text-[var(--text-3)] truncate">
                                — {upload.detected_chapter}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[var(--text-3)]">
                            {new Date(upload.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
