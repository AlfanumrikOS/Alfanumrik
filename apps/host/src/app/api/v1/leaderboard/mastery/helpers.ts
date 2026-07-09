export interface LearnerMasteryRow {
  auth_user_id: string;
  mastery: number;
}

export interface StudentMeta {
  id: string;
  auth_user_id: string;
  name: string;
  grade: string;
  school_name: string | null;
  avatar_url: string | null;
}

export interface MasteryLeaderboardItem {
  rank: number;
  student_id: string;
  name: string;
  grade: string;
  school: string | null;
  avatar_url: string | null;
  mean_mastery: number;
  chapters_counted: number;
}

export interface MasteryLeaderboardResponse {
  schemaVersion: 1;
  period: 'mastery';
  resolvedAt: string;
  items: MasteryLeaderboardItem[];
}

export function aggregateMastery(
  masteryRows: LearnerMasteryRow[],
  minChapters: number,
): Map<string, { mean: number; count: number }> {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of masteryRows) {
    if (r.mastery == null || Number.isNaN(r.mastery)) continue;
    const existing = acc.get(r.auth_user_id);
    if (existing) {
      existing.sum += r.mastery;
      existing.count += 1;
    } else {
      acc.set(r.auth_user_id, { sum: r.mastery, count: 1 });
    }
  }
  const out = new Map<string, { mean: number; count: number }>();
  for (const [uid, { sum, count }] of acc) {
    if (count < minChapters) continue;
    out.set(uid, { mean: sum / count, count });
  }
  return out;
}

export function buildLeaderboardItems(
  aggregated: Map<string, { mean: number; count: number }>,
  students: StudentMeta[],
  limit: number,
): MasteryLeaderboardItem[] {
  const merged: Array<{
    student: StudentMeta;
    mean: number;
    count: number;
  }> = [];
  for (const s of students) {
    const agg = aggregated.get(s.auth_user_id);
    if (!agg) continue;
    merged.push({ student: s, mean: agg.mean, count: agg.count });
  }
  merged.sort((a, b) => {
    if (a.mean !== b.mean) return b.mean - a.mean;
    return b.count - a.count;
  });
  return merged.slice(0, limit).map((m, i) => ({
    rank: i + 1,
    student_id: m.student.id,
    name: m.student.name,
    grade: m.student.grade,
    school: m.student.school_name,
    avatar_url: m.student.avatar_url,
    mean_mastery: m.mean,
    chapters_counted: m.count,
  }));
}
