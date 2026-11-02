export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: 'referee' | 'player' | null;
          avatar_url: string | null;
          experience: 'beginner' | 'novice' | 'intermediate' | 'expert' | null;
          photo_urls: Json;
          created_at: string;
          last_active_at: string | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: 'referee' | 'player' | null;
          avatar_url?: string | null;
          experience?: 'beginner' | 'novice' | 'intermediate' | 'expert' | null;
          photo_urls?: Json;
          created_at?: string;
          last_active_at?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: 'referee' | 'player' | null;
          avatar_url?: string | null;
          experience?: 'beginner' | 'novice' | 'intermediate' | 'expert' | null;
          photo_urls?: Json;
          created_at?: string;
          last_active_at?: string | null;
        };
        Relationships: [];
      };
      match_sessions: {
        Row: {
          id: string;
          umpire_id: string;
          format: 'singles' | 'doubles';
          target_score: number;
          win_by: number;
          status: 'in_progress' | 'completed' | 'abandoned';
          team_keys: Json; // [string, string]
          team_names: Json; // [string, string]
          team_palettes: Json; // [string, string]
          player_names: Json; // { team0: string[]; team1: string[] }
          initial_state: Json; // RallyState
          score_team0: number;
          score_team1: number;
          serving_team: number; // 0 | 1
          server_number: number; // 1 | 2
          server_court: 'right' | 'left';
          court_positions: Json; // [{ left: string, right: string }, { left: string, right: string }]
          winner_team: number | null;
          head_sequence: number;
          version: number;
          timer_status: 'idle' | 'running' | 'paused' | 'expired';
          timer_duration_ms: number;
          timer_remaining_ms: number;
          timer_ends_at: string | null;
          timer_updated_at: string;
          legacy_log: Json | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          umpire_id?: string;
          format?: 'singles' | 'doubles';
          target_score?: number;
          win_by?: number;
          status?: 'in_progress' | 'completed' | 'abandoned';
          team_keys?: Json;
          team_names?: Json;
          team_palettes?: Json;
          player_names?: Json;
          initial_state: Json;
          score_team0?: number;
          score_team1?: number;
          serving_team?: number;
          server_number?: number;
          server_court?: 'right' | 'left';
          court_positions: Json;
          winner_team?: number | null;
          head_sequence?: number;
          version?: number;
          timer_status?: 'idle' | 'running' | 'paused' | 'expired';
          timer_duration_ms?: number;
          timer_remaining_ms?: number;
          timer_ends_at?: string | null;
          timer_updated_at?: string;
          legacy_log?: Json | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          umpire_id?: string;
          format?: 'singles' | 'doubles';
          target_score?: number;
          win_by?: number;
          status?: 'in_progress' | 'completed' | 'abandoned';
          team_keys?: Json;
          team_names?: Json;
          team_palettes?: Json;
          player_names?: Json;
          initial_state?: Json;
          score_team0?: number;
          score_team1?: number;
          serving_team?: number;
          server_number?: number;
          server_court?: 'right' | 'left';
          court_positions?: Json;
          winner_team?: number | null;
          head_sequence?: number;
          version?: number;
          timer_status?: 'idle' | 'running' | 'paused' | 'expired';
          timer_duration_ms?: number;
          timer_remaining_ms?: number;
          timer_ends_at?: string | null;
          timer_updated_at?: string;
          legacy_log?: Json | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_sessions_umpire_id_fkey';
            columns: ['umpire_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      match_events: {
        Row: {
          id: string;
          session_id: string;
          sequence: number;
          status: 'active' | 'undone' | 'discarded';
          event_type: 'point' | 'secondServer' | 'sideOut' | 'gameWon';
          elapsed_seconds: number;
          state_after: Json; // RallyState
          call_string: string;
          message: string;
          created_by: string;
          created_at: string;
          status_changed_at: string;
        };
        Insert: {
          id: string;
          session_id: string;
          sequence: number;
          status?: 'active' | 'undone' | 'discarded';
          event_type: 'point' | 'secondServer' | 'sideOut' | 'gameWon';
          elapsed_seconds?: number;
          state_after: Json;
          call_string: string;
          message: string;
          created_by?: string;
          created_at?: string;
          status_changed_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          sequence?: number;
          status?: 'active' | 'undone' | 'discarded';
          event_type?: 'point' | 'secondServer' | 'sideOut' | 'gameWon';
          elapsed_seconds?: number;
          state_after?: Json;
          call_string?: string;
          message?: string;
          created_by?: string;
          created_at?: string;
          status_changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_events_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'match_sessions';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      fn_create_session: {
        Args: {
          p_session_id: string;
          p_format: string;
          p_team_keys: Json;
          p_team_names: Json;
          p_team_palettes: Json;
          p_player_names: Json;
          p_initial_state: Json;
          p_timer_duration_ms?: number;
          p_legacy_log?: Json | null;
          p_auto_start_timer?: boolean;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_record_rally: {
        Args: {
          p_session_id: string;
          p_event_id: string;
          p_expected_version: number;
          p_event_type: string;
          p_elapsed_seconds: number;
          p_state_after: Json;
          p_call_string: string;
          p_message: string;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_undo_rally: {
        Args: {
          p_session_id: string;
          p_expected_version: number;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_redo_rally: {
        Args: {
          p_session_id: string;
          p_expected_version: number;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_set_timer: {
        Args: {
          p_session_id: string;
          p_status: string;
          p_remaining_ms: number;
          p_ends_at: string | null;
          p_client_ts: string;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_update_session_meta: {
        Args: {
          p_session_id: string;
          p_team_names?: Json;
          p_team_palettes?: Json;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
      fn_close_session: {
        Args: {
          p_session_id: string;
          p_status: string;
        };
        Returns: Database['public']['Tables']['match_sessions']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// ==========================================
// Convenient Domain Helper Types
// ==========================================
export type MatchSessionRow = Database['public']['Tables']['match_sessions']['Row'];
export type MatchEventRow = Database['public']['Tables']['match_events']['Row'];
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface RallyState {
  format: 'singles' | 'doubles';
  scores: [number, number];
  servingTeam: 0 | 1;
  serverNumber: 1 | 2;
  serverCourt: 'right' | 'left';
  courtPositions: [
    { left: string; right: string },
    { left: string; right: string }
  ];
  gameOver: boolean;
  winner: 0 | 1 | null;
}
