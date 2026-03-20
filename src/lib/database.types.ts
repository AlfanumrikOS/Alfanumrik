// Minimal stub — avoids 'never' typing issues with Supabase client
// In production, run: npx supabase gen types typescript --project-id dxipobqngyfpqbbznojz > src/lib/database.types.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export interface Database {
  public: {
    Tables: { [key: string]: { Row: any; Insert: any; Update: any } };
    Views: { [key: string]: { Row: any } };
    Functions: { [key: string]: { Args: any; Returns: any } };
    Enums: { [key: string]: string };
  };
}
