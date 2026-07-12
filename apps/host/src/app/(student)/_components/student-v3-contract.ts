import type { TodayQueueItem } from '@alfanumrik/lib/today/types';

export function safeTodayHref(item: TodayQueueItem): string {
  const candidate = item.deepLink.route;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/today';
  const route = candidate;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(item.deepLink.params ?? {})) {
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

export function studentRecommendationReason(type: TodayQueueItem['type'], isHi: boolean): string {
  const reasons: Partial<Record<TodayQueueItem['type'], [string, string]>> = {
    cold_start_diagnostic: ['This short check helps Alfanumrik understand your starting point.', 'यह छोटा आकलन अल्फ़ानुमरिक को आपका शुरुआती स्तर समझने में मदद करेगा।'],
    srs_due: ['Review now because these ideas are due before they fade.', 'इन विचारों को भूलने से पहले आज दोहराना सही समय है।'],
    revise_decayed_topic: ['This topic needs a quick refresh to protect your mastery.', 'अपनी मास्टरी बनाए रखने के लिए इस विषय का छोटा रिव्यू करें।'],
    weak_topic_zpd: ['This is the best next challenge for your current level.', 'यह आपके वर्तमान स्तर के लिए अगली सही चुनौती है।'],
    practice_weakest: ['Practice here to strengthen the area needing most attention.', 'सबसे अधिक ध्यान वाले क्षेत्र को मजबूत करने के लिए यहाँ अभ्यास करें।'],
    continue_lesson: ['Continue while your recent learning is still fresh.', 'हाल की सीख अभी ताज़ा है—यहीं से आगे बढ़ें।'],
    new_topic: ['You are ready to begin the next concept in your plan.', 'आप अपनी योजना की अगली अवधारणा शुरू करने के लिए तैयार हैं।'],
    teacher_remediation: ['Your teacher selected this to help close a specific gap.', 'आपके शिक्षक ने एक खास कमी दूर करने के लिए इसे चुना है।'],
  };
  const value = reasons[type];
  if (!value) return isHi ? 'यह आपकी वर्तमान सीखने की योजना में अगला प्राथमिक कदम है।' : 'This is ranked next from your current learning plan.';
  return isHi ? value[1] : value[0];
}
