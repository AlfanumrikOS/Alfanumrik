-- ALFANUMRIK — SQL Migration for Classroom Integration and Lesson Planner
--
-- Adds the `classroom_lesson_plans` table to store daily teacher lesson plans mapped to NCERT curriculum topics.
-- Enforces Row-Level Security (RLS) to ensure data confidentiality and cross-tenant compliance (P13).

CREATE TABLE IF NOT EXISTS "public"."classroom_lesson_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "class_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "topic_id" "uuid" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "classroom_lesson_plans_class_date_key" UNIQUE ("class_id", "date")
);

-- Foreign Key Constraints
ALTER TABLE ONLY "public"."classroom_lesson_plans"
    ADD CONSTRAINT "classroom_lesson_plans_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."classroom_lesson_plans"
    ADD CONSTRAINT "classroom_lesson_plans_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."curriculum_topics"("id") ON DELETE CASCADE;

-- Row Level Security (RLS)
ALTER TABLE "public"."classroom_lesson_plans" ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Service role manages lesson plans" ON "public"."classroom_lesson_plans"
    TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "Teachers can view classroom lesson plans" ON "public"."classroom_lesson_plans"
    FOR SELECT TO "authenticated" USING (
        "class_id" IN (
            SELECT "ct"."class_id"
            FROM "public"."class_teachers" "ct"
            JOIN "public"."teachers" "t" ON "t"."id" = "ct"."teacher_id"
            WHERE "t"."auth_user_id" = "auth"."uid"()
        )
    );

CREATE POLICY "Teachers can manage classroom lesson plans" ON "public"."classroom_lesson_plans"
    FOR ALL TO "authenticated" USING (
        "class_id" IN (
            SELECT "ct"."class_id"
            FROM "public"."class_teachers" "ct"
            JOIN "public"."teachers" "t" ON "t"."id" = "ct"."teacher_id"
            WHERE "t"."auth_user_id" = "auth"."uid"()
        )
    ) WITH CHECK (
        "class_id" IN (
            SELECT "ct"."class_id"
            FROM "public"."class_teachers" "ct"
            JOIN "public"."teachers" "t" ON "t"."id" = "ct"."teacher_id"
            WHERE "t"."auth_user_id" = "auth"."uid"()
        )
    );

CREATE POLICY "Students can view classroom lesson plans" ON "public"."classroom_lesson_plans"
    FOR SELECT TO "authenticated" USING (
        "class_id" IN (
            SELECT "cs"."class_id"
            FROM "public"."class_students" "cs"
            JOIN "public"."students" "s" ON "s"."id" = "cs"."student_id"
            WHERE "s"."auth_user_id" = "auth"."uid"()
        )
    );

-- Performance Indexes
CREATE INDEX IF NOT EXISTS "idx_classroom_lesson_plans_class_id" ON "public"."classroom_lesson_plans" USING "btree" ("class_id");
CREATE INDEX IF NOT EXISTS "idx_classroom_lesson_plans_date" ON "public"."classroom_lesson_plans" USING "btree" ("date");
