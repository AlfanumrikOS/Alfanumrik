'use client';
import React, { useState } from 'react';
import { useFoxyOS } from '../../../hooks/useFoxyOS';
import { FoxyRenderEngine } from '../../../components/FoxyRenderEngine';

export default function FoxyTestPage() {
  const { uiState, loading, error, startTopic, submitEvent } = useFoxyOS("STU_E2E_1");
  const [topic, setTopic] = useState('newtons_third_law');

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-200">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-red-500">
            Foxy-X OS: End-to-End Proving Ground
          </h1>
          <p className="text-slate-400 mt-2">
            Watch the AI dynamically shift formats, grant dopamine, and scale difficulty in real-time.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <input 
            type="text" 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="px-4 py-2 bg-slate-800 rounded text-white border border-slate-700"
          />
          <button 
            onClick={() => startTopic(topic)}
            disabled={loading}
            className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded font-medium disabled:opacity-50"
          >
            1. Start Topic (Hook)
          </button>
          <button 
            onClick={() => submitEvent('continue')}
            disabled={loading || !uiState}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50"
          >
            Next Stage
          </button>
          
          <div className="w-full h-px bg-slate-700 my-2"></div>
          
          <button 
            onClick={() => submitEvent('quiz_submit', { correct: false, time_taken: 65 }, { accuracy: 40.0, time_spent: 65 })}
            disabled={loading || !uiState}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800 rounded text-sm"
          >
            Simulate Struggle (High Effort, Fail)
          </button>
          
          <button 
            onClick={() => submitEvent('voice_submit', { text_transcript: "Because the forces are equal and opposite." })}
            disabled={loading || !uiState}
            className="px-4 py-2 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-200 border border-emerald-800 rounded text-sm"
          >
            Submit Voice Explanation (Teach Stage)
          </button>
        </div>

        {/* Errors / Loading */}
        {error && <div className="p-4 bg-red-900/50 text-red-200 border border-red-800 rounded">{error}</div>}
        {loading && <div className="text-slate-400 animate-pulse">Communicating with AI Brain...</div>}

        {/* Output */}
        {uiState && (
          <FoxyRenderEngine uiState={uiState} />
        )}
        
        {!uiState && !loading && (
          <div className="text-center p-12 border-2 border-dashed border-slate-800 rounded-xl text-slate-600">
            Click "Start Topic" to initialize the Learning Loop.
          </div>
        )}
      </div>
    </div>
  );
}
