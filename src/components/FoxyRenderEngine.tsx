'use client';
import React from 'react';
import { UIState } from '../hooks/useFoxyOS';

interface FoxyRenderEngineProps {
  uiState: UIState;
}

export function FoxyRenderEngine({ uiState }: FoxyRenderEngineProps) {
  // If we are in the Hook stage, we render the schema from ContentRenderingEngine
  if (uiState.loop_stage === 'HOOK' && uiState.ui_schema) {
    const schema = uiState.ui_schema;
    const instruction = schema.render_instruction || {};
    
    return (
      <div className="p-6 bg-slate-900 rounded-xl border border-slate-700 text-white shadow-2xl">
        <h2 className="text-2xl font-bold mb-4 text-foxy-orange">Foxy-X Render: {instruction.component}</h2>
        <p className="text-lg text-slate-300 italic mb-6">&quot;{schema.original_text}&quot;</p>
        
        {/* Mocking the actual components based on schema intent */}
        {instruction.component === 'interactive_canvas' && (
          <div className="h-48 w-full bg-slate-800 border-2 border-dashed border-slate-600 flex items-center justify-center rounded-lg">
            <span className="text-slate-400 font-mono">Interactive Simulation Sandbox (Mock)</span>
          </div>
        )}
        
        {instruction.component === 'accordion_steps' && (
          <div className="space-y-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="p-3 bg-slate-800 rounded flex justify-between">
                <span>Step {step}</span>
                <span>+</span>
              </div>
            ))}
          </div>
        )}
        
        {instruction.component === 'text_block' && (
          <div className="p-4 bg-slate-800 rounded-lg font-serif text-lg leading-relaxed">
            Standard reading text block.
          </div>
        )}
      </div>
    );
  }

  // Generic fallback for other stages
  return (
    <div className="p-6 bg-slate-900 rounded-xl border border-slate-700 text-white shadow-2xl">
      <h2 className="text-2xl font-bold mb-4 text-blue-400">Current Stage: {uiState.loop_stage || uiState.new_stage}</h2>
      
      {uiState.ui_instruction && (
        <div className="mb-4 p-4 bg-blue-900/30 border border-blue-800 rounded-lg">
          <p className="font-semibold text-blue-300">System Instruction:</p>
          <p>{uiState.ui_instruction}</p>
        </div>
      )}

      {uiState.adaptive_difficulty && (
        <div className="mb-4 p-4 bg-purple-900/30 border border-purple-800 rounded-lg">
          <p className="font-semibold text-purple-300">Adaptive Brain Output:</p>
          <p>Decision: {uiState.adaptive_difficulty.decision}</p>
          <p>Message: &quot;{uiState.adaptive_difficulty.message}&quot;</p>
          <p>Format: {uiState.adaptive_difficulty.format} (Challenge: {uiState.adaptive_difficulty.new_challenge_level})</p>
        </div>
      )}

      {uiState.dopamine_events && uiState.dopamine_events.length > 0 && (
        <div className="mb-4 p-4 bg-green-900/30 border border-green-800 rounded-lg">
          <p className="font-semibold text-green-400">Dopamine Triggers!</p>
          <ul className="list-disc list-inside">
            {uiState.dopamine_events.map((evt, idx) => (
              <li key={idx} className="text-green-200">{evt.message} ({evt.ui_pattern})</li>
            ))}
          </ul>
        </div>
      )}
      
      {uiState.hif_feedback && (
        <div className="mb-4 p-4 bg-yellow-900/30 border border-yellow-800 rounded-lg">
          <p className="font-semibold text-yellow-400">Human Intelligence Feedback:</p>
          <p className="text-yellow-200">{uiState.hif_feedback}</p>
        </div>
      )}
    </div>
  );
}
