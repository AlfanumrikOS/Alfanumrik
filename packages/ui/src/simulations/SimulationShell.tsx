'use client';

import { type ReactNode, Component, type ErrorInfo } from 'react';

interface SimulationShellProps {
  title: string;
  titleHi?: string;
  concept?: string;
  conceptHi?: string;
  instructions?: string;
  instructionsHi?: string;
  grade?: string;
  subject?: string;
  children: ReactNode;
  controls?: ReactNode;
  observations?: ReactNode;
  isHi?: boolean;
}

// Error boundary for simulation crashes
class SimErrorBoundary extends Component<
  { children: ReactNode; title: string },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: ReactNode; title: string }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[simulation-crash]', this.props.title, error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-xl text-center min-h-[300px]">
          <p className="text-red-600 font-semibold mb-2">
            Simulation failed to load
          </p>
          <p className="text-sm text-red-500 mb-4">{this.state.error}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm min-h-[44px]"
          >
            Reload Simulation
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export { SimErrorBoundary };

export function SimulationShell({
  title,
  titleHi,
  concept,
  conceptHi,
  instructions,
  instructionsHi,
  grade,
  subject,
  children,
  controls,
  observations,
  isHi,
}: SimulationShellProps) {
  const displayTitle = isHi && titleHi ? titleHi : title;
  const displayConcept = isHi && conceptHi ? conceptHi : concept;
  const displayInstructions =
    isHi && instructionsHi ? instructionsHi : instructions;

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">{displayTitle}</h2>
        {displayConcept && (
          <p className="text-sm text-gray-500 mt-0.5">{displayConcept}</p>
        )}
        {grade && subject && (
          <div className="flex gap-2 mt-1">
            <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded">
              Grade {grade}
            </span>
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
              {subject}
            </span>
          </div>
        )}
      </div>

      {/* Instructions (collapsible on mobile) */}
      {displayInstructions && (
        <details className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800" open>
          <summary className="font-medium cursor-pointer">
            {isHi ? 'निर्देश' : 'Instructions'}
          </summary>
          <p className="mt-2 leading-relaxed">{displayInstructions}</p>
        </details>
      )}

      {/* Simulation area with error boundary */}
      <SimErrorBoundary title={title}>
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Canvas / visual area */}
          <div className="flex-1 min-w-0">{children}</div>

          {/* Control panel: stacks below on mobile, beside on desktop */}
          {controls && (
            <div className="lg:w-64 flex-shrink-0">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">
                  {isHi ? 'नियंत्रण' : 'Controls'}
                </h3>
                {controls}
              </div>
            </div>
          )}
        </div>
      </SimErrorBoundary>

      {/* Observation panel */}
      {observations && (
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
          <h3 className="text-sm font-semibold text-amber-800 mb-2">
            {isHi ? 'अवलोकन' : 'Observations'}
          </h3>
          {observations}
        </div>
      )}
    </div>
  );
}

export default SimulationShell;