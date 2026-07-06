'use client';

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';

// ============================================================================
// 1. TYPES & INTERFACES
// ============================================================================

interface Topic {
  id: string;
  title: string;
  chapter_number: number;
}

interface Message {
  id: number;
  role: 'student' | 'tutor';
  content: string;
}

// ============================================================================
// 2. CONTEXT & PROVIDERS
// ============================================================================

interface FoxyDataContextType {
  activeSubject: string;
  setActiveSubject: (subject: string) => void;
  studentGrade: string;
  activeTopic: Topic | null;
  setActiveTopic: (topic: Topic | null) => void;
  language: string;
  setLanguage: (lang: string) => void;
}

interface FoxyUIContextType {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  reportModal: { msgId: number; foxyMsg: string } | null;
  setReportModal: (modal: { msgId: number; foxyMsg: string } | null) => void;
}

const FoxyDataContext = createContext<FoxyDataContextType | undefined>(undefined);
const FoxyUIContext = createContext<FoxyUIContextType | undefined>(undefined);

function FoxyProvider({ children }: { children: React.ReactNode }) {
  // Data States
  const [activeSubject, setActiveSubject] = useState('science');
  const [studentGrade] = useState('9');
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [language, setLanguage] = useState('en');

  // UI States
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [reportModal, setReportModal] = useState<{ msgId: number; foxyMsg: string } | null>(null);

  // Memoized values to prevent unnecessary re-renders
  const dataValue = useMemo(() => ({
    activeSubject, setActiveSubject, studentGrade, activeTopic, setActiveTopic, language, setLanguage
  }), [activeSubject, studentGrade, activeTopic, language]);

  const uiValue = useMemo(() => ({
    sidebarOpen, setSidebarOpen, reportModal, setReportModal
  }), [sidebarOpen, reportModal]);

  return (
    <FoxyDataContext.Provider value={dataValue}>
      <FoxyUIContext.Provider value={uiValue}>
        {children}
      </FoxyUIContext.Provider>
    </FoxyDataContext.Provider>
  );
}

// Custom Hooks for Context Consumption
const useFoxyData = () => {
  const context = useContext(FoxyDataContext);
  if (!context) throw new Error('useFoxyData must be used within FoxyProvider');
  return context;
};

const useFoxyUI = () => {
  const context = useContext(FoxyUIContext);
  if (!context) throw new Error('useFoxyUI must be used within FoxyProvider');
  return context;
};

// ============================================================================
// 3. MOCKED DATA HOOKS (Replace with Supabase/API logic)
// ============================================================================

function useTopics(subject: string, grade: string) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Simulate network request
    setTimeout(() => {
      setTopics(
        subject === 'science'
          ? [
              { id: '1', title: 'Matter in Our Surroundings', chapter_number: 1 },
              { id: '2', title: 'Is Matter Around Us Pure?', chapter_number: 2 },
              { id: '3', title: 'Atoms and Molecules', chapter_number: 3 },
            ]
          : [
              { id: '4', title: 'Number Systems', chapter_number: 1 },
              { id: '5', title: 'Polynomials', chapter_number: 2 },
            ]
      );
      setLoading(false);
    }, 500);
  }, [subject, grade]);

  return { topics, loading };
}

function useFoxyChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = (content: string) => {
    const userMsg: Message = { id: Date.now(), role: 'student', content };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Simulate AI streaming response
    setTimeout(() => {
      const aiMsg: Message = { id: Date.now() + 1, role: 'tutor', content: 'That is a great question! Based on your textbook, here is how we approach this...' };
      setMessages((prev) => [...prev, aiMsg]);
      setLoading(false);
    }, 1200);
  };

  return { messages, sendMessage, loading };
}

// ============================================================================
// 4. UI COMPONENTS
// ============================================================================

function MainHeader() {
  const { activeSubject, setActiveSubject, language, setLanguage } = useFoxyData();
  const { sidebarOpen, setSidebarOpen } = useFoxyUI();

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-gray-100 rounded-md xl:hidden"
        >
          ☰
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-xl shadow-sm">
            🦊
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">Foxy <span className="text-[10px] font-semibold text-gray-500 uppercase">AI Tutor</span></h1>
            <p className="text-xs text-gray-500">Grade 9 • 1,240 XP</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <select 
          value={activeSubject} 
          onChange={(e) => setActiveSubject(e.target.value)}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-500/20"
        >
          <option value="science">🔬 Science</option>
          <option value="math">📐 Math</option>
        </select>
        
        <select 
          value={language} 
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-500/20"
        >
          <option value="en">EN</option>
          <option value="hi">HI</option>
        </select>
      </div>
    </header>
  );
}

function TopicSidebar() {
  const { activeSubject, studentGrade, activeTopic, setActiveTopic } = useFoxyData();
  const { sidebarOpen } = useFoxyUI();
  const { topics, loading } = useTopics(activeSubject, studentGrade);

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col h-full shrink-0 absolute xl:relative z-20 transition-all">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-bold text-xs tracking-wider uppercase text-gray-500">
          Chapters ({topics.length})
        </h3>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="animate-pulse flex flex-col gap-3">
            <div className="h-10 bg-gray-200 rounded-xl w-full"></div>
            <div className="h-10 bg-gray-200 rounded-xl w-full"></div>
          </div>
        ) : (
          topics.map((topic) => {
            const isActive = activeTopic?.id === topic.id;
            return (
              <button
                key={topic.id}
                onClick={() => setActiveTopic(topic)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all border ${
                  isActive 
                    ? 'bg-orange-50 border-orange-200 text-orange-900 shadow-sm' 
                    : 'bg-white border-transparent text-gray-700 hover:border-gray-200 hover:shadow-sm'
                }`}
              >
                <div className="text-[11px] font-bold text-gray-400 mb-0.5">Ch {topic.chapter_number}</div>
                <div className="font-semibold truncate">{topic.title}</div>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}

function ChatContainer() {
  const { activeTopic } = useFoxyData();
  const { setReportModal } = useFoxyUI();
  const { messages, sendMessage, loading } = useFoxyChat();
  const [input, setInput] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
  };

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-white relative">
      {/* Context Banner */}
      {activeTopic && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs font-medium text-blue-800 flex justify-center shadow-sm">
          Currently teaching: Chapter {activeTopic.chapter_number} - {activeTopic.title}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto animate-in fade-in zoom-in duration-500">
            <div className="text-6xl mb-4">🦊</div>
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">Hi! I am Foxy</h2>
            <p className="text-sm text-gray-500">
              Select a chapter from the sidebar or just ask me a question to get started.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'student' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                msg.role === 'student' 
                  ? 'bg-orange-500 text-white rounded-tr-none' 
                  : 'bg-gray-100 text-gray-900 rounded-tl-none border border-gray-200'
              }`}>
                {msg.content}
                {msg.role === 'tutor' && (
                  <div className="mt-2 pt-2 border-t border-gray-200/50 flex justify-end">
                    <button 
                      onClick={() => setReportModal({ msgId: msg.id, foxyMsg: msg.content })}
                      className="text-[10px] font-medium text-gray-400 hover:text-red-500 transition-colors"
                    >
                      Report Issue
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3 text-sm text-gray-500 border border-gray-200 flex items-center gap-2 shadow-sm animate-pulse">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-200">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Foxy anything..."
            className="w-full bg-gray-50 border border-gray-300 rounded-full pl-5 pr-12 py-3.5 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
          />
          <button 
            type="submit"
            disabled={!input.trim() || loading}
            className="absolute right-2 top-2 bottom-2 aspect-square bg-orange-500 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:bg-gray-300 transition-colors shadow-sm"
          >
            ↑
          </button>
        </form>
      </div>
    </main>
  );
}

function ReportModal() {
  const { reportModal, setReportModal } = useFoxyUI();

  if (!reportModal) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-bold text-gray-900">Report an Issue</h2>
          <button onClick={() => setReportModal(null)} className="text-gray-400 hover:text-gray-700 text-lg">×</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-red-50 text-red-900 text-xs p-3 rounded-lg border border-red-100 max-h-32 overflow-y-auto">
            <span className="font-bold block mb-1">AI Response:</span>
            "{reportModal.foxyMsg}"
          </div>
          <textarea 
            placeholder="What went wrong with this explanation?"
            className="w-full min-h-[100px] p-3 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 resize-none"
          />
        </div>
        <div className="p-4 bg-gray-50 flex justify-end gap-2 border-t border-gray-100">
          <button 
            onClick={() => setReportModal(null)} 
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => setReportModal(null)}
            className="px-4 py-2 text-sm font-semibold bg-red-500 text-white hover:bg-red-600 rounded-lg shadow-sm transition-colors"
          >
            Submit Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. MAIN PAGE COMPONENT
// ============================================================================

export default function FoxyPage() {
  return (
    <FoxyProvider>
      {/* Root Container */}
      <div className="flex flex-col h-screen w-full overflow-hidden bg-gray-50 text-gray-900 font-sans">
        
        {/* Modals mounted at the highest level to prevent z-index/layout issues */}
        <ReportModal />

        {/* Global Layout Header */}
        <MainHeader />

        {/* Main Interface Layout */}
        <div className="flex flex-1 overflow-hidden relative">
          <TopicSidebar />
          <ChatContainer />
        </div>

      </div>
    </FoxyProvider>
  );
}
