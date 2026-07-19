'use client';

/**
 * VerticalMathBlock — CSS Grid-based renderer for columnar arithmetic.
 *
 * Renders right-aligned digit columns for:
 * - Addition/Subtraction (carry row + operands + rule + result)
 * - Multiplication (operands + partial products + rule + result)
 * - Long division (divisor bracket + dividend + cascading subtractions)
 *
 * Uses font-mono + Tailwind grid. No external dependencies.
 * Bilingual labels via CHROME map (P7).
 */

import React, { memo } from 'react';
import type { FoxyVerticalMathBlock } from '@alfanumrik/lib/foxy/schema';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface VerticalMathBlockProps {
  block: FoxyVerticalMathBlock;
}

interface VertMathChrome {
  carry: string;
  remainder: string;
  quotient: string;
}

const CHROME: { en: VertMathChrome; hi: VertMathChrome } = {
  en: {
    carry: 'Carry',
    remainder: 'Remainder',
    quotient: 'Quotient',
  },
  hi: {
    carry: 'हासिल',
    remainder: 'शेषफल',
    quotient: 'भागफल',
  },
};

/** Pad a number string to a fixed width with leading spaces. */
function padLeft(s: string, width: number): string[] {
  const digits = s.split('');
  while (digits.length < width) digits.unshift('');
  return digits;
}

function AddSubBlock({
  block,
  chrome,
}: {
  block: FoxyVerticalMathBlock;
  chrome: VertMathChrome;
}) {
  const operands = block.operands;
  const result = block.result;
  const carry = block.carry_row ?? [];
  const maxLen = Math.max(
    ...operands.map((o) => o.replace(/[^0-9.]/g, '').length),
    result.replace(/[^0-9.]/g, '').length,
    carry.length
  );
  const operator = block.operation === 'addition' ? '+' : '\u2212';

  return (
    <div className="inline-block font-mono text-lg leading-relaxed">
      {/* Carry row */}
      {carry.length > 0 && (
        <div className="flex justify-end gap-0 text-xs text-orange-500 mb-0.5">
          <span className="w-6" />
          {padLeft(carry.join(''), maxLen).map((d, i) => (
            <span key={i} className="w-6 text-center">
              {d}
            </span>
          ))}
        </div>
      )}
      {/* Operands */}
      {operands.map((op, idx) => (
        <div key={idx} className="flex justify-end gap-0">
          <span className="w-6 text-center text-gray-500">
            {idx === operands.length - 1 ? operator : ''}
          </span>
          {padLeft(op, maxLen).map((d, i) => (
            <span key={i} className="w-6 text-center">
              {d}
            </span>
          ))}
        </div>
      ))}
      {/* Rule line */}
      <div className="border-b-2 border-gray-700 dark:border-gray-300 my-1" />
      {/* Result */}
      <div className="flex justify-end gap-0 font-bold text-purple-600 dark:text-purple-400">
        <span className="w-6" />
        {padLeft(result, maxLen).map((d, i) => (
          <span key={i} className="w-6 text-center">
            {d}
          </span>
        ))}
      </div>
      {block.remainder && (
        <div className="text-sm text-gray-500 mt-1">
          {chrome.remainder}: {block.remainder}
        </div>
      )}
    </div>
  );
}

function MultiplicationBlock({ block }: { block: FoxyVerticalMathBlock }) {
  const [multiplicand, multiplier] = block.operands;
  const steps = block.intermediate_steps ?? [];
  const result = block.result;
  const maxLen = Math.max(
    multiplicand?.length ?? 0,
    multiplier?.length ?? 0,
    result.length,
    ...steps.map((s) => s.length)
  );

  return (
    <div className="inline-block font-mono text-lg leading-relaxed">
      {/* Multiplicand */}
      <div className="flex justify-end gap-0">
        <span className="w-6" />
        {padLeft(multiplicand ?? '', maxLen).map((d, i) => (
          <span key={i} className="w-6 text-center">
            {d}
          </span>
        ))}
      </div>
      {/* Multiplier with × */}
      <div className="flex justify-end gap-0">
        <span className="w-6 text-center text-gray-500">&times;</span>
        {padLeft(multiplier ?? '', maxLen).map((d, i) => (
          <span key={i} className="w-6 text-center">
            {d}
          </span>
        ))}
      </div>
      {/* Rule */}
      <div className="border-b-2 border-gray-700 dark:border-gray-300 my-1" />
      {/* Intermediate steps (partial products) */}
      {steps.map((step, idx) => (
        <div key={idx} className="flex justify-end gap-0 text-gray-600 dark:text-gray-400">
          <span className="w-6" />
          {padLeft(step, maxLen).map((d, i) => (
            <span key={i} className="w-6 text-center">
              {d}
            </span>
          ))}
        </div>
      ))}
      {steps.length > 0 && (
        <div className="border-b-2 border-gray-700 dark:border-gray-300 my-1" />
      )}
      {/* Final result */}
      <div className="flex justify-end gap-0 font-bold text-purple-600 dark:text-purple-400">
        <span className="w-6" />
        {padLeft(result, maxLen).map((d, i) => (
          <span key={i} className="w-6 text-center">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

function LongDivisionBlock({
  block,
  chrome,
}: {
  block: FoxyVerticalMathBlock;
  chrome: VertMathChrome;
}) {
  const [dividend, divisor] = block.operands;
  const result = block.result;
  const steps = block.intermediate_steps ?? [];

  return (
    <div className="inline-block font-mono text-lg leading-relaxed">
      {/* Quotient label */}
      <div className="text-sm text-gray-500 mb-1">
        {chrome.quotient}: <span className="font-bold text-purple-600 dark:text-purple-400">{result}</span>
      </div>
      {/* Division bracket */}
      <div className="flex items-start gap-1">
        <span className="text-gray-700 dark:text-gray-300 self-start mt-1">
          {divisor})
        </span>
        <div className="border-t-2 border-l-2 border-gray-700 dark:border-gray-300 pl-2 pt-1">
          <div className="font-bold">{dividend}</div>
          {/* Cascading subtractions */}
          {steps.map((step, idx) => (
            <div key={idx} className="text-gray-600 dark:text-gray-400 text-sm">
              {step}
            </div>
          ))}
        </div>
      </div>
      {block.remainder && (
        <div className="text-sm text-gray-500 mt-1">
          {chrome.remainder}: {block.remainder}
        </div>
      )}
    </div>
  );
}

export const VerticalMathBlock = memo(function VerticalMathBlock({
  block,
}: VerticalMathBlockProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;

  return (
    <div className="my-3 flex justify-center">
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        {block.label && (
          <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">
            {block.label}
          </div>
        )}
        {(block.operation === 'addition' || block.operation === 'subtraction') && (
          <AddSubBlock block={block} chrome={chrome} />
        )}
        {block.operation === 'multiplication' && (
          <MultiplicationBlock block={block} />
        )}
        {block.operation === 'long_division' && (
          <LongDivisionBlock block={block} chrome={chrome} />
        )}
      </div>
    </div>
  );
});
