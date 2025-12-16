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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      bitrate_records: {
        Row: {
          bitrate_value: number
          channel_id: string
          created_at: string
          id: string
          operator_id: string | null
          recorded_at: string
          shift_time: Database["public"]["Enums"]["shift_time"]
        }
        Insert: {
          bitrate_value: number
          channel_id: string
          created_at?: string
          id?: string
          operator_id?: string | null
          recorded_at?: string
          shift_time: Database["public"]["Enums"]["shift_time"]
        }
        Update: {
          bitrate_value?: number
          channel_id?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          recorded_at?: string
          shift_time?: Database["public"]["Enums"]["shift_time"]
        }
        Relationships: [
          {
            foreignKeyName: "bitrate_records_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitrate_records_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          bitrate: number | null
          created_at: string
          frequency: string | null
          id: string
          modulation: string | null
          name: string
          polarization: string | null
          satellite_id: string | null
          status: Database["public"]["Enums"]["channel_status"] | null
          stream_url: string | null
          symbol_rate: string | null
          updated_at: string
        }
        Insert: {
          bitrate?: number | null
          created_at?: string
          frequency?: string | null
          id?: string
          modulation?: string | null
          name: string
          polarization?: string | null
          satellite_id?: string | null
          status?: Database["public"]["Enums"]["channel_status"] | null
          stream_url?: string | null
          symbol_rate?: string | null
          updated_at?: string
        }
        Update: {
          bitrate?: number | null
          created_at?: string
          frequency?: string | null
          id?: string
          modulation?: string | null
          name?: string
          polarization?: string | null
          satellite_id?: string | null
          status?: Database["public"]["Enums"]["channel_status"] | null
          stream_url?: string | null
          symbol_rate?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_satellite_id_fkey"
            columns: ["satellite_id"]
            isOneToOne: false
            referencedRelation: "satellites"
            referencedColumns: ["id"]
          },
        ]
      }
      client_channels: {
        Row: {
          channel_id: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          channel_id: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          channel_id?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_channels_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_channels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          client_name: string
          created_at: string
          email: string | null
          id: string
          phone1: string
          phone2: string | null
          updated_at: string
        }
        Insert: {
          client_name: string
          created_at?: string
          email?: string | null
          id?: string
          phone1: string
          phone2?: string | null
          updated_at?: string
        }
        Update: {
          client_name?: string
          created_at?: string
          email?: string | null
          id?: string
          phone1?: string
          phone2?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dtl: {
        Row: {
          client_id: string | null
          created_at: string
          date: string
          dish: string | null
          encoder: string | null
          end_time: string
          fees: number | null
          from_location: string | null
          guest_name: string | null
          id: string
          issue_description: string | null
          notes: string | null
          operator_id: string | null
          power_amplifier: string | null
          reason: string | null
          satellite_id: string | null
          start_time: string
          transmission_type: Database["public"]["Enums"]["transmission_type"]
          updated_at: string
          via_location: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          date?: string
          dish?: string | null
          encoder?: string | null
          end_time: string
          fees?: number | null
          from_location?: string | null
          guest_name?: string | null
          id?: string
          issue_description?: string | null
          notes?: string | null
          operator_id?: string | null
          power_amplifier?: string | null
          reason?: string | null
          satellite_id?: string | null
          start_time: string
          transmission_type: Database["public"]["Enums"]["transmission_type"]
          updated_at?: string
          via_location?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          date?: string
          dish?: string | null
          encoder?: string | null
          end_time?: string
          fees?: number | null
          from_location?: string | null
          guest_name?: string | null
          id?: string
          issue_description?: string | null
          notes?: string | null
          operator_id?: string | null
          power_amplifier?: string | null
          reason?: string | null
          satellite_id?: string | null
          start_time?: string
          transmission_type?: Database["public"]["Enums"]["transmission_type"]
          updated_at?: string
          via_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dtl_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dtl_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dtl_satellite_id_fkey"
            columns: ["satellite_id"]
            isOneToOne: false
            referencedRelation: "sng_satellites"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          channel_id: string | null
          created_at: string
          description: string | null
          detail: string | null
          end_date: string | null
          id: string
          issue_type: Database["public"]["Enums"]["issue_type"]
          operator_id: string | null
          reason: string | null
          resolution_reason: string | null
          satellite_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["issue_status"] | null
          title: string
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          description?: string | null
          detail?: string | null
          end_date?: string | null
          id?: string
          issue_type: Database["public"]["Enums"]["issue_type"]
          operator_id?: string | null
          reason?: string | null
          resolution_reason?: string | null
          satellite_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["issue_status"] | null
          title: string
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          description?: string | null
          detail?: string | null
          end_date?: string | null
          id?: string
          issue_type?: Database["public"]["Enums"]["issue_type"]
          operator_id?: string | null
          reason?: string | null
          resolution_reason?: string | null
          satellite_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["issue_status"] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_satellite_id_fkey"
            columns: ["satellite_id"]
            isOneToOne: false
            referencedRelation: "satellites"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          note: string | null
          operator_id: string
          start_date: string
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          note?: string | null
          operator_id: string
          start_date: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          note?: string | null
          operator_id?: string
          start_date?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          title?: string
        }
        Relationships: []
      }
      operators: {
        Row: {
          active: boolean | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      satellites: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          date: string
          id: string
          notes: string | null
          operator_id: string | null
          shift_time: Database["public"]["Enums"]["shift_time"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          operator_id?: string | null
          shift_time: Database["public"]["Enums"]["shift_time"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          operator_id?: string | null
          shift_time?: Database["public"]["Enums"]["shift_time"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      sng_satellites: {
        Row: {
          created_at: string
          dish: string | null
          encoder: string | null
          id: string
          name: string
          power_amplifier: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dish?: string | null
          encoder?: string | null
          id?: string
          name: string
          power_amplifier?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dish?: string | null
          encoder?: string | null
          id?: string
          name?: string
          power_amplifier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      channel_status: "active" | "inactive" | "maintenance"
      issue_status: "open" | "resolved"
      issue_type: "Image" | "Sound" | "Graphic"
      leave_type: "annual" | "sick-reported" | "sick-unreported" | "extra"
      shift_time: "morning" | "evening" | "night"
      transmission_type:
        | "SNG"
        | "TVU"
        | "AVIWEST"
        | "UNIVISO"
        | "LiveU"
        | "Turnaround"
        | "SRT Link"
        | "RTMP Link"
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
      channel_status: ["active", "inactive", "maintenance"],
      issue_status: ["open", "resolved"],
      issue_type: ["Image", "Sound", "Graphic"],
      leave_type: ["annual", "sick-reported", "sick-unreported", "extra"],
      shift_time: ["morning", "evening", "night"],
      transmission_type: [
        "SNG",
        "TVU",
        "AVIWEST",
        "UNIVISO",
        "LiveU",
        "Turnaround",
        "SRT Link",
        "RTMP Link",
      ],
    },
  },
} as const
