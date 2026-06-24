-- Adds foxy_extra_chats column to students table for the coin shop
-- extra_chats_5 item increments this; Foxy chat limit enforcement reads it.
-- Additive, non-breaking. Default 0 means no extra chats unless purchased.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS foxy_extra_chats INTEGER NOT NULL DEFAULT 0;
