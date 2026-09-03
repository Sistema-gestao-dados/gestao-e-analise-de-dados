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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: string
          user_agent: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_agent?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_agent?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
      classificacao_operacional: {
        Row: {
          classificacao: string
          created_at: string
          detalhes: Json | null
          encerra_garagem: boolean
          id: string
          km_total: number
          linha_dominante: string | null
          num_motoristas: number
          num_turnos: number
          primeira_partida: string | null
          servico: string
          tem_aproveitamento: boolean
          tem_direto: boolean
          tem_rendicao: boolean
          tem_tu: boolean
          termina_comercial: boolean
          tipo_operacao: string
          total_viagens: number
          turnos: string[]
          ultima_chegada: string | null
          updated_at: string
          versao_programacao: string
        }
        Insert: {
          classificacao: string
          created_at?: string
          detalhes?: Json | null
          encerra_garagem?: boolean
          id?: string
          km_total?: number
          linha_dominante?: string | null
          num_motoristas?: number
          num_turnos?: number
          primeira_partida?: string | null
          servico: string
          tem_aproveitamento?: boolean
          tem_direto?: boolean
          tem_rendicao?: boolean
          tem_tu?: boolean
          termina_comercial?: boolean
          tipo_operacao: string
          total_viagens?: number
          turnos?: string[]
          ultima_chegada?: string | null
          updated_at?: string
          versao_programacao: string
        }
        Update: {
          classificacao?: string
          created_at?: string
          detalhes?: Json | null
          encerra_garagem?: boolean
          id?: string
          km_total?: number
          linha_dominante?: string | null
          num_motoristas?: number
          num_turnos?: number
          primeira_partida?: string | null
          servico?: string
          tem_aproveitamento?: boolean
          tem_direto?: boolean
          tem_rendicao?: boolean
          tem_tu?: boolean
          termina_comercial?: boolean
          tipo_operacao?: string
          total_viagens?: number
          turnos?: string[]
          ultima_chegada?: string | null
          updated_at?: string
          versao_programacao?: string
        }
        Relationships: []
      }
      importacoes: {
        Row: {
          arquivo: string | null
          created_at: string
          detalhes: Json | null
          id: string
          registros_atualizados: number
          registros_erro: number
          registros_inseridos: number
          tipo: string
        }
        Insert: {
          arquivo?: string | null
          created_at?: string
          detalhes?: Json | null
          id?: string
          registros_atualizados?: number
          registros_erro?: number
          registros_inseridos?: number
          tipo: string
        }
        Update: {
          arquivo?: string | null
          created_at?: string
          detalhes?: Json | null
          id?: string
          registros_atualizados?: number
          registros_erro?: number
          registros_inseridos?: number
          tipo?: string
        }
        Relationships: []
      }
      linhas: {
        Row: {
          antec_t1: number
          antec_t2: number
          antec_t3: number
          categoria: string | null
          created_at: string
          empresa: string | null
          linha: string
          ordem: string | null
          prest_t1: number
          prest_t2: number
          prest_t3: number
          unidade: string | null
          updated_at: string
        }
        Insert: {
          antec_t1?: number
          antec_t2?: number
          antec_t3?: number
          categoria?: string | null
          created_at?: string
          empresa?: string | null
          linha: string
          ordem?: string | null
          prest_t1?: number
          prest_t2?: number
          prest_t3?: number
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          antec_t1?: number
          antec_t2?: number
          antec_t3?: number
          categoria?: string | null
          created_at?: string
          empresa?: string | null
          linha?: string
          ordem?: string | null
          prest_t1?: number
          prest_t2?: number
          prest_t3?: number
          unidade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      parametro_km: {
        Row: {
          created_at: string
          descricao: string | null
          destino: string
          id: string
          km: number
          linha: string
          origem: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          destino: string
          id?: string
          km?: number
          linha: string
          origem: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          destino?: string
          id?: string
          km?: number
          linha?: string
          origem?: string
        }
        Relationships: []
      }
      parametro_multilinha: {
        Row: {
          created_at: string
          grupo_du: string
          id: string
          linha: string
          tipo_dia: string
        }
        Insert: {
          created_at?: string
          grupo_du: string
          id?: string
          linha: string
          tipo_dia: string
        }
        Update: {
          created_at?: string
          grupo_du?: string
          id?: string
          linha?: string
          tipo_dia?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ativo: boolean
          created_at: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          nome?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projeto_ativo: {
        Row: {
          created_at: string
          id: string
          linha: string
          tipo_operacao: string
          updated_at: string
          versao_programacao: string
        }
        Insert: {
          created_at?: string
          id?: string
          linha: string
          tipo_operacao: string
          updated_at?: string
          versao_programacao: string
        }
        Update: {
          created_at?: string
          id?: string
          linha?: string
          tipo_operacao?: string
          updated_at?: string
          versao_programacao?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      viagens: {
        Row: {
          arquivo: string | null
          carro: string | null
          categoria_movimento: string | null
          chegada: string | null
          created_at: string
          dedupe_key: string | null
          destino: string | null
          id: string
          linha: string
          origem: string | null
          partida: string | null
          sentido: string | null
          servico: string | null
          tempo_viagem: string | null
          tipo_movimento: string | null
          tipo_operacao: string | null
          tipo_servico: string | null
          turno: string | null
          versao_programacao: string | null
        }
        Insert: {
          arquivo?: string | null
          carro?: string | null
          categoria_movimento?: string | null
          chegada?: string | null
          created_at?: string
          dedupe_key?: string | null
          destino?: string | null
          id?: string
          linha: string
          origem?: string | null
          partida?: string | null
          sentido?: string | null
          servico?: string | null
          tempo_viagem?: string | null
          tipo_movimento?: string | null
          tipo_operacao?: string | null
          tipo_servico?: string | null
          turno?: string | null
          versao_programacao?: string | null
        }
        Update: {
          arquivo?: string | null
          carro?: string | null
          categoria_movimento?: string | null
          chegada?: string | null
          created_at?: string
          dedupe_key?: string | null
          destino?: string | null
          id?: string
          linha?: string
          origem?: string | null
          partida?: string | null
          sentido?: string | null
          servico?: string | null
          tempo_viagem?: string | null
          tipo_movimento?: string | null
          tipo_operacao?: string | null
          tipo_servico?: string | null
          turno?: string | null
          versao_programacao?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_first_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
