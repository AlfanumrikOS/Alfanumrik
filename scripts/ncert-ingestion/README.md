# NCERT Curriculum Ingestion Pipeline

Replaces the old Alfanumrik curriculum with updated NCERT textbook content.

## Prerequisites

1. NCERT books in PDF/text format, organized by class and subject:
   ```
   NCERT books/
     Class 6/
       Mathematics.pdf
       Science.pdf
     Class 7/
       Mathematics.pdf
       Science.pdf
     ...
     Class 12/
       Physics Part 1.pdf
       Chemistry Part 1.pdf
   ```

2. Environment variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

3. Dependencies:
   ```bash
   npm install pdf-parse  # For PDF extraction
   ```

## Usage

```bash
# Full ingestion from local NCERT books folder
npx tsx scripts/ncert-ingestion/ingest.ts --source "/path/to/NCERT books"

# Validate coverage after ingestion
npx tsx scripts/check-content-gaps.ts
```

## What It Does

1. **Discovers** all PDF/text files, auto-detects grade and subject from path/filename
2. **Extracts** text from each file, splits into chapters
3. **Chunks** chapter text into 200-500 token retrieval units
4. **Deprecates** old content (sets `is_active = false` — soft delete)
5. **Uploads** new chunks with `source = 'ncert_2025'` tag
6. **Updates** curriculum_topics table
7. **Validates** coverage across all grade × subject combinations

## Safety

- Old content is soft-deleted, not hard-deleted
- New content tagged with `source = 'ncert_2025'` for traceability
- Rollback: set old content `is_active = true`, new content `is_active = false`
- Validation runs automatically after ingestion

## After Ingestion

1. Run `scripts/check-content-gaps.ts` to verify coverage
2. Foxy tutor automatically uses `is_active = true` content via RAG
3. Quiz generator automatically uses `is_active = true` questions
4. Invalidate any caches (the ingestion doesn't touch application caches)

## Image Extraction (Future)

PDF image extraction requires additional dependencies:
- `pdf-lib` for PDF page rendering
- `sharp` for image processing
- Supabase Storage bucket for image hosting

This will be added in the next phase when image-aware RAG is implemented.
