// Tests for revision_models.dart's fromJson decoders — RevisionCard,
// RevisionGradeResult, RevisionStackItem, RevisionRetentionTest, and
// RevisionModality.fromString. These decoders are pure display-value
// parsing; they never compute an SM-2 schedule or mastery value — see the
// safety-boundary docstring in revision_models.dart.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/revision_models.dart';

void main() {
  group('RevisionModality.fromString', () {
    test('parses all three known values', () {
      expect(RevisionModality.fromString('read'), RevisionModality.read);
      expect(RevisionModality.fromString('explainer'), RevisionModality.explainer);
      expect(
        RevisionModality.fromString('worked-example'),
        RevisionModality.workedExample,
      );
    });

    test('falls back to read for null/unknown', () {
      expect(RevisionModality.fromString(null), RevisionModality.read);
      expect(RevisionModality.fromString('bogus'), RevisionModality.read);
    });
  });

  group('RevisionCard.fromJson', () {
    test('parses a full spaced_repetition_cards-shaped row', () {
      final card = RevisionCard.fromJson({
        'id': 'card-1',
        'subject': 'math',
        'topic': 'math:3:q42',
        'chapter_title': 'Chapter 3',
        'front_text': 'What is 2+2?',
        'back_text': '4',
        'hint': 'Count on your fingers',
        'source': 'quiz_wrong_answer',
        'ease_factor': 2.6,
        'interval_days': 6,
        'streak': 2,
        'repetition_count': 3,
        'total_reviews': 5,
        'correct_reviews': 4,
        'last_review_date': '2026-07-15',
      });

      expect(card.id, 'card-1');
      expect(card.subject, 'math');
      expect(card.chapterTitle, 'Chapter 3');
      expect(card.frontText, 'What is 2+2?');
      expect(card.backText, '4');
      expect(card.hint, 'Count on your fingers');
      expect(card.source, 'quiz_wrong_answer');
      expect(card.easeFactor, 2.6);
      expect(card.intervalDays, 6);
      expect(card.streak, 2);
      expect(card.repetitionCount, 3);
      expect(card.totalReviews, 5);
      expect(card.correctReviews, 4);
      expect(card.lastReviewDate, '2026-07-15');
    });

    test('degrades safely on missing fields (never throws)', () {
      final card = RevisionCard.fromJson(const {});
      expect(card.id, '');
      expect(card.easeFactor, 2.5);
      expect(card.intervalDays, 0);
      expect(card.streak, 0);
    });

    test('displayLabel prefers chapterTitle, falls back to topic', () {
      final withChapter = RevisionCard.fromJson({
        'id': 'c1',
        'topic': 'math:3:q42',
        'chapter_title': 'Chapter 3',
        'ease_factor': 2.5,
      });
      expect(withChapter.displayLabel, 'Chapter 3');

      final withoutChapter = RevisionCard.fromJson({
        'id': 'c2',
        'topic': 'Photosynthesis',
        'chapter_title': '',
      });
      expect(withoutChapter.displayLabel, 'Photosynthesis');
    });
  });

  group('RevisionGradeResult.fromJson', () {
    test('parses the POST /api/learner/review/grade "card" envelope', () {
      final result = RevisionGradeResult.fromJson({
        'id': 'card-1',
        'ease_factor': 2.7,
        'interval_days': 12,
        'streak': 3,
        'repetition_count': 4,
        'next_review_date': '2026-08-02',
        'last_review_date': '2026-07-21',
        'last_quality': 4,
        'total_reviews': 6,
        'correct_reviews': 5,
      });

      expect(result.easeFactor, 2.7);
      expect(result.intervalDays, 12);
      expect(result.streak, 3);
      expect(result.nextReviewDate, '2026-08-02');
      expect(result.lastQuality, 4);
    });
  });

  group('RevisionStackItem.fromJson', () {
    test('parses a revise-stack item', () {
      final item = RevisionStackItem.fromJson({
        'subjectCode': 'science',
        'chapterNumber': 7,
        'mastery': 0.42,
        'daysSinceLastTouch': 21,
        'recommendedModality': 'explainer',
        'url': '/learn/science/7?mode=read&from=revise',
      });

      expect(item.subjectCode, 'science');
      expect(item.chapterNumber, 7);
      expect(item.mastery, 0.42);
      expect(item.daysSinceLastTouch, 21);
      expect(item.recommendedModality, RevisionModality.explainer);
      expect(item.url, '/learn/science/7?mode=read&from=revise');
    });
  });

  group('RevisionRetentionTest.fromJson', () {
    test('parses a retention_tests row', () {
      final test0 = RevisionRetentionTest.fromJson({
        'id': 'rt-1',
        'topic_title': 'Newton\'s Laws',
        'subject': 'physics',
        'predicted_retention': 0.38,
        'scheduled_date': '2026-07-20',
      });

      expect(test0.id, 'rt-1');
      expect(test0.topicTitle, "Newton's Laws");
      expect(test0.subject, 'physics');
      expect(test0.predictedRetention, 0.38);
      expect(test0.scheduledDate, '2026-07-20');
    });
  });
}
