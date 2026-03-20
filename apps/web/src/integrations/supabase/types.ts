export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_suggestions: {
        Row: {
          affected_members: string[]
          created_at: string
          description: string
          id: string
          priority: string
          type: string
        }
        Insert: {
          affected_members?: string[]
          created_at?: string
          description: string
          id?: string
          priority: string
          type: string
        }
        Update: {
          affected_members?: string[]
          created_at?: string
          description?: string
          id?: string
          priority?: string
          type?: string
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          region: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          region: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          region?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_team_profile_id: string | null
          availability_preferences: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          onboarding_completed_at: string | null
          phone: string | null
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          active_team_profile_id?: string | null
          availability_preferences?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          onboarding_completed_at?: string | null
          phone?: string | null
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          active_team_profile_id?: string | null
          availability_preferences?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_team_profile_id_fkey"
            columns: ["active_team_profile_id"]
            isOneToOne: false
            referencedRelation: "team_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          end_time: string
          has_rest_violation: boolean | null
          id: string
          is_conflict: boolean
          is_efficient: boolean
          is_high_fatigue: boolean
          is_pending: boolean
          member_id: string
          shift_type: string
          start_time: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          has_rest_violation?: boolean | null
          id?: string
          is_conflict?: boolean
          is_efficient?: boolean
          is_high_fatigue?: boolean
          is_pending?: boolean
          member_id: string
          shift_type?: string
          start_time: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          has_rest_violation?: boolean | null
          id?: string
          is_conflict?: boolean
          is_efficient?: boolean
          is_high_fatigue?: boolean
          is_pending?: boolean
          member_id?: string
          shift_type?: string
          start_time?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "team_members_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          avatar: string | null
          contract_type: string
          created_at: string
          email: string | null
          fatigue_score: number
          id: string
          initials: string
          max_hours: number
          name: string
          region: string
          role: string
          seniority: string
          skills: string[]
          timezone: string
          updated_at: string
          weekly_hours: number | null
        }
        Insert: {
          avatar?: string | null
          contract_type: string
          created_at?: string
          email?: string | null
          fatigue_score?: number
          id?: string
          initials: string
          max_hours?: number
          name: string
          region: string
          role: string
          seniority: string
          skills?: string[]
          timezone?: string
          updated_at?: string
          weekly_hours?: number | null
        }
        Update: {
          avatar?: string | null
          contract_type?: string
          created_at?: string
          email?: string | null
          fatigue_score?: number
          id?: string
          initials?: string
          max_hours?: number
          name?: string
          region?: string
          role?: string
          seniority?: string
          skills?: string[]
          timezone?: string
          updated_at?: string
          weekly_hours?: number | null
        }
        Relationships: []
      }
      team_profiles: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_user_id: string
          template_key: string | null
          updated_at: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_user_id: string
          template_key?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_user_id?: string
          template_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      time_off_requests: {
        Row: {
          created_at: string
          end_date: string
          id: string
          manager_notes: string | null
          notes: string | null
          partial_end: string | null
          partial_start: string | null
          request_type: string
          start_date: string
          status: string
          swap_target_shift_id: string | null
          team_member_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          manager_notes?: string | null
          notes?: string | null
          partial_end?: string | null
          partial_start?: string | null
          request_type: string
          start_date: string
          status?: string
          swap_target_shift_id?: string | null
          team_member_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          manager_notes?: string | null
          notes?: string | null
          partial_end?: string | null
          partial_start?: string | null
          request_type?: string
          start_date?: string
          status?: string
          swap_target_shift_id?: string | null
          team_member_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_swap_target_shift_id_fkey"
            columns: ["swap_target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      team_members_safe: {
        Row: {
          avatar: string | null
          contract_type: string | null
          created_at: string | null
          fatigue_score: number | null
          id: string | null
          initials: string | null
          max_hours: number | null
          name: string | null
          region: string | null
          role: string | null
          seniority: string | null
          skills: string[] | null
          timezone: string | null
          updated_at: string | null
          weekly_hours: number | null
        }
        Insert: {
          avatar?: string | null
          contract_type?: string | null
          created_at?: string | null
          fatigue_score?: number | null
          id?: string | null
          initials?: string | null
          max_hours?: number | null
          name?: string | null
          region?: string | null
          role?: string | null
          seniority?: string | null
          skills?: string[] | null
          timezone?: string | null
          updated_at?: string | null
          weekly_hours?: number | null
        }
        Update: {
          avatar?: string | null
          contract_type?: string | null
          created_at?: string | null
          fatigue_score?: number | null
          id?: string | null
          initials?: string | null
          max_hours?: number | null
          name?: string | null
          region?: string | null
          role?: string | null
          seniority?: string | null
          skills?: string[] | null
          timezone?: string | null
          updated_at?: string | null
          weekly_hours?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "manager" | "employee"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "manager", "employee"],
    },
  },
} as const
