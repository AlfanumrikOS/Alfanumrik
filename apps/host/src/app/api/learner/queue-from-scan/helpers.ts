export function buildFlashcardPayload(args: {
  scanId: string;
  studentId: string;
  extractedText: string;
  subject: string | null;
  grade: string | null;
}): {
  student_id: string;
  card_type: string;
  subject: string;
  grade: string;
  front_text: string;
  back_text: string;
  source: string;
  source_id: string;
} {
  const front = args.extractedText.trim().slice(0, 1000);
  return {
    student_id: args.studentId,
    card_type: 'scan_question',
    subject: (args.subject ?? 'general').toLowerCase(),
    grade: args.grade ?? '0',
    front_text: front,
    back_text: '(Solve to reveal the answer)',
    source: 'scan',
    source_id: args.scanId,
  };
}
