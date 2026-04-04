'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, SectionHeader, LoadingFoxy, BottomNav, Badge } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import ScanSolver from '@/components/ScanSolver';
import type { ScanSolveResult } from '@/components/ScanSolver';

/* ─── Types ─── */
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

type TabMode = 'solve' | 'upload';

export default function ScanPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab: "solve" (Scan & Solve) vs "upload" (legacy upload & learn)
  const [activeTab, setActiveTab] = useState<TabMode>('solve');

  // Upload state (for legacy upload mode)
  const [selectedType, setSelectedType] = useState<string>('assignment');
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Recent uploads
  const [recentUploads, setRecentUploads] = useState<ImageUpload[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Scan & Solve results history (current session)
  const [solveHistory, setSolveHistory] = useState<ScanSolveResult[]>([]);

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

  /* ─── Handle file upload (legacy mode) ─── */
  const handleFile = async (file: File) => {
    if (!student || !file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage(isHi ? 'कृपया एक इमेज फ़ाइल चुनें' : 'Please select an image file');
      setUploadState('error');
      return;
    }

    setUploadState('uploading');
    setErrorMessage('');

    try {
      const path = `${student.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('uploads').upload(path, file);

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        setErrorMessage(isHi ? 'अपलोड में त्रुटि' : 'Upload failed');
        setUploadState('error');
        return;
      }

      const url = supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl;

      await supabase.from('image_uploads').insert({
        student_id: student.id,
        image_url: url,
        image_type: selectedType,
        processing_status: 'pending',
      });

      setUploadState('done');
      loadRecent();
    } catch (e) {
      console.error('File handling error:', e);
      setErrorMessage(isHi ? 'फ़ाइल प्रोसेसिंग में त्रुटि' : 'Error processing file');
      setUploadState('error');
    }
  };

  /* ─── Drag and Drop handlers ─── */
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleSolveComplete = useCallback((result: ScanSolveResult) => {
    setSolveHistory(prev => [result, ...prev]);
  }, []);

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
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <SectionErrorBoundary section="Scan">
          {/* ═══ Tab Switcher ═══ */}
          <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
            <button
              onClick={() => setActiveTab('solve')}
              className="flex-1 text-xs font-semibold py-2 rounded-lg transition-all"
              style={{
                background: activeTab === 'solve' ? 'var(--surface-1)' : 'transparent',
                color: activeTab === 'solve' ? 'var(--orange)' : 'var(--text-3)',
                boxShadow: activeTab === 'solve' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {isHi ? 'स्कैन और हल करो' : 'Scan & Solve'}
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className="flex-1 text-xs font-semibold py-2 rounded-lg transition-all"
              style={{
                background: activeTab === 'upload' ? 'var(--surface-1)' : 'transparent',
                color: activeTab === 'upload' ? 'var(--orange)' : 'var(--text-3)',
                boxShadow: activeTab === 'upload' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {isHi ? 'अपलोड करो' : 'Upload'}
            </button>
          </div>

          {/* ═══ SCAN & SOLVE TAB ═══ */}
          {activeTab === 'solve' && (
            <>
              <ScanSolver
                studentId={student.id}
                grade={student.grade}
                subject={student.preferred_subject || undefined}
                isHi={isHi}
                onSolveComplete={handleSolveComplete}
              />

              {/* Session history */}
              {solveHistory.length > 0 && (
                <>
                  <SectionHeader icon="🕐">
                    {isHi ? 'इस सत्र के हल' : 'This Session'}
                  </SectionHeader>
                  <div className="space-y-2">
                    {solveHistory.map((h, idx) => (
                      <Card key={h.scan_id || idx} hoverable>
                        <div className="flex items-start gap-2">
                          <span className="text-lg flex-shrink-0">{h.solution ? '✅' : '📝'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--text-1)] truncate">{h.extracted_text || '—'}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge
                                size="sm"
                                color={h.status === 'solved' ? '#16A34A' : '#F59E0B'}
                              >
                                {h.status === 'solved'
                                  ? (isHi ? 'हल' : 'Solved')
                                  : (isHi ? 'केवल OCR' : 'OCR Only')}
                              </Badge>
                              {h.solution?.confidence !== undefined && (
                                <span className="text-[10px] text-[var(--text-3)]">
                                  {Math.round(h.solution.confidence * 100)}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ UPLOAD TAB (legacy) ═══ */}
          {activeTab === 'upload' && (
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
              {(uploadState === 'idle' || uploadState === 'error') && (
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
                  <div className="text-5xl mb-3">{isDragging ? '📥' : '📤'}</div>
                  <h3 className="text-sm font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                    {isDragging
                      ? (isHi ? 'यहाँ छोड़ें' : 'Drop here')
                      : (isHi ? 'इमेज अपलोड करें' : 'Upload Image')}
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mb-3">
                    {isHi ? 'खींचकर छोड़ें या क्लिक करें' : 'Drag & drop or click to browse'}
                  </p>
                  <Button
                    size="sm"
                    variant="soft"
                    color="var(--orange)"
                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    {isHi ? '📁 फ़ाइल चुनें' : '📁 Choose File'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>
              )}

              {/* Upload states */}
              {uploadState === 'uploading' && (
                <div className="text-center py-12">
                  <div className="text-4xl animate-float mb-3">📤</div>
                  <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi ? 'अपलोड हो रहा है...' : 'Uploading...'}
                  </p>
                </div>
              )}

              {uploadState === 'done' && (
                <Card accent="#16A34A">
                  <div className="text-center py-4">
                    <div className="text-3xl mb-2">✅</div>
                    <p className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                      {isHi ? 'अपलोड सफल!' : 'Upload Successful!'}
                    </p>
                    <Button size="sm" variant="soft" color="var(--orange)" onClick={() => setUploadState('idle')} className="mt-3">
                      {isHi ? 'और अपलोड करें' : 'Upload Another'}
                    </Button>
                  </div>
                </Card>
              )}

              {uploadState === 'error' && errorMessage && (
                <Card accent="#EF4444">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">&#9888;&#65039;</span>
                    <p className="text-xs text-[#EF4444] font-medium">{errorMessage}</p>
                  </div>
                  <Button size="sm" variant="soft" color="#EF4444" onClick={() => { setUploadState('idle'); setErrorMessage(''); }} className="mt-2">
                    {isHi ? 'फिर कोशिश करें' : 'Try Again'}
                  </Button>
                </Card>
              )}

              {/* ═══ RECENT SCANS ═══ */}
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
                    const typeConfig = IMAGE_TYPES.find(tc => tc.id === upload.image_type);
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
