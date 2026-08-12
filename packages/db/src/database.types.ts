export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alerta: {
        Row: {
          canal: Database["public"]["Enums"]["canal_alerta"]
          creado_at: string
          estado: Database["public"]["Enums"]["estado_alerta"]
          id: string
          marca_id: string | null
          payload: Json
          severidad: Database["public"]["Enums"]["severidad_alerta"]
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_alerta"]
          visita_id: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["canal_alerta"]
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_alerta"]
          id?: string
          marca_id?: string | null
          payload?: Json
          severidad?: Database["public"]["Enums"]["severidad_alerta"]
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_alerta"]
          visita_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["canal_alerta"]
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_alerta"]
          id?: string
          marca_id?: string | null
          payload?: Json
          severidad?: Database["public"]["Enums"]["severidad_alerta"]
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_alerta"]
          visita_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerta_marca_fk"
            columns: ["marca_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "alerta_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerta_visita_fk"
            columns: ["visita_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "visita"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      cadena: {
        Row: {
          activo: boolean
          codigo_externo: string | null
          creado_at: string
          id: string
          nombre: string
          tenant_id: string
          tipo_tienda: Database["public"]["Enums"]["tipo_tienda"] | null
        }
        Insert: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          nombre: string
          tenant_id: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
        }
        Update: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          nombre?: string
          tenant_id?: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
        }
        Relationships: [
          {
            foreignKeyName: "cadena_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      categoria: {
        Row: {
          activo: boolean
          codigo_externo: string | null
          creado_at: string
          id: string
          nombre: string
          tenant_id: string
        }
        Insert: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          nombre: string
          tenant_id: string
        }
        Update: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          nombre?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categoria_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      config_perfect_store: {
        Row: {
          categoria_id: string | null
          creado_at: string
          creado_por: string | null
          id: string
          marca_id: string
          orden_bien_pts: number
          orden_mal_pts: number
          orden_regular_pts: number
          peso_distribucion: number
          peso_orden: number
          peso_pop: number
          peso_precio: number
          peso_visibilidad: number
          politica_pop: Database["public"]["Enums"]["politica_pop"]
          sos_objetivo_pct: number
          sos_unidad: Database["public"]["Enums"]["unidad_sos"]
          tenant_id: string
          tipo_tienda: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde: string
        }
        Insert: {
          categoria_id?: string | null
          creado_at?: string
          creado_por?: string | null
          id?: string
          marca_id: string
          orden_bien_pts?: number
          orden_mal_pts?: number
          orden_regular_pts?: number
          peso_distribucion: number
          peso_orden: number
          peso_pop: number
          peso_precio: number
          peso_visibilidad: number
          politica_pop?: Database["public"]["Enums"]["politica_pop"]
          sos_objetivo_pct: number
          sos_unidad?: Database["public"]["Enums"]["unidad_sos"]
          tenant_id: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde?: string
        }
        Update: {
          categoria_id?: string | null
          creado_at?: string
          creado_por?: string | null
          id?: string
          marca_id?: string
          orden_bien_pts?: number
          orden_mal_pts?: number
          orden_regular_pts?: number
          peso_distribucion?: number
          peso_orden?: number
          peso_pop?: number
          peso_precio?: number
          peso_visibilidad?: number
          politica_pop?: Database["public"]["Enums"]["politica_pop"]
          sos_objetivo_pct?: number
          sos_unidad?: Database["public"]["Enums"]["unidad_sos"]
          tenant_id?: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_perfect_store_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_perfect_store_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_ps_categoria_fk"
            columns: ["categoria_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "categoria"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "config_ps_marca_fk"
            columns: ["marca_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      configuracion_plataforma: {
        Row: {
          actualizado_at: string
          actualizado_por: string | null
          id: boolean
          otp_canales_habilitados: Database["public"]["Enums"]["canal_otp"][]
          otp_requerido: boolean
        }
        Insert: {
          actualizado_at?: string
          actualizado_por?: string | null
          id?: boolean
          otp_canales_habilitados?: Database["public"]["Enums"]["canal_otp"][]
          otp_requerido?: boolean
        }
        Update: {
          actualizado_at?: string
          actualizado_por?: string | null
          id?: boolean
          otp_canales_habilitados?: Database["public"]["Enums"]["canal_otp"][]
          otp_requerido?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_plataforma_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      contingencia: {
        Row: {
          comentario: string | null
          creado_at: string
          foto_id: string | null
          id: string
          levantamiento_id: string | null
          motivo: string
          paso: Database["public"]["Enums"]["paso_levantamiento"]
          paso_config_id: string | null
          registrada_at: string
          tenant_id: string
          visita_id: string
        }
        Insert: {
          comentario?: string | null
          creado_at?: string
          foto_id?: string | null
          id?: string
          levantamiento_id?: string | null
          motivo: string
          paso: Database["public"]["Enums"]["paso_levantamiento"]
          paso_config_id?: string | null
          registrada_at: string
          tenant_id?: string
          visita_id: string
        }
        Update: {
          comentario?: string | null
          creado_at?: string
          foto_id?: string | null
          id?: string
          levantamiento_id?: string | null
          motivo?: string
          paso?: Database["public"]["Enums"]["paso_levantamiento"]
          paso_config_id?: string | null
          registrada_at?: string
          tenant_id?: string
          visita_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cont_foto_fk"
            columns: ["foto_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "cont_lev_fk"
            columns: ["levantamiento_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "cont_visita_fk"
            columns: ["visita_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "visita"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "contingencia_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      exhibicion: {
        Row: {
          completa: boolean | null
          creado_at: string
          exhibicion_negociada_id: string | null
          foto_id: string | null
          id: string
          instalada: boolean | null
          levantamiento_id: string
          tenant_id: string
          tipo_adicional: Database["public"]["Enums"]["tipo_exhibicion"] | null
          unidades: number | null
          vigente: boolean | null
        }
        Insert: {
          completa?: boolean | null
          creado_at?: string
          exhibicion_negociada_id?: string | null
          foto_id?: string | null
          id?: string
          instalada?: boolean | null
          levantamiento_id: string
          tenant_id?: string
          tipo_adicional?: Database["public"]["Enums"]["tipo_exhibicion"] | null
          unidades?: number | null
          vigente?: boolean | null
        }
        Update: {
          completa?: boolean | null
          creado_at?: string
          exhibicion_negociada_id?: string | null
          foto_id?: string | null
          id?: string
          instalada?: boolean | null
          levantamiento_id?: string
          tenant_id?: string
          tipo_adicional?: Database["public"]["Enums"]["tipo_exhibicion"] | null
          unidades?: number | null
          vigente?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exh_foto_fk"
            columns: ["foto_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "exh_lev_fk"
            columns: ["levantamiento_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "exh_neg_ref_fk"
            columns: ["exhibicion_negociada_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "exhibicion_negociada"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "exhibicion_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      exhibicion_negociada: {
        Row: {
          cantidad_sugerida: number | null
          creado_at: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          marca_id: string
          sku_ids: string[]
          tenant_id: string
          tienda_id: string
          tipo: Database["public"]["Enums"]["tipo_exhibicion"]
        }
        Insert: {
          cantidad_sugerida?: number | null
          creado_at?: string
          fecha_fin: string
          fecha_inicio: string
          id?: string
          marca_id: string
          sku_ids?: string[]
          tenant_id: string
          tienda_id: string
          tipo: Database["public"]["Enums"]["tipo_exhibicion"]
        }
        Update: {
          cantidad_sugerida?: number | null
          creado_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          marca_id?: string
          sku_ids?: string[]
          tenant_id?: string
          tienda_id?: string
          tipo?: Database["public"]["Enums"]["tipo_exhibicion"]
        }
        Relationships: [
          {
            foreignKeyName: "exh_neg_marca_fk"
            columns: ["marca_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "exh_neg_tienda_fk"
            columns: ["tienda_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tienda"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "exhibicion_negociada_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_levantamiento: {
        Row: {
          activo: boolean
          creado_at: string
          id: string
          marca_id: string | null
          nombre: string
          tenant_id: string
        }
        Insert: {
          activo?: boolean
          creado_at?: string
          id?: string
          marca_id?: string | null
          nombre: string
          tenant_id: string
        }
        Update: {
          activo?: boolean
          creado_at?: string
          id?: string
          marca_id?: string | null
          nombre?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulario_levantamiento_marca_id_fkey"
            columns: ["marca_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_levantamiento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_version: {
        Row: {
          creada_at: string
          definicion: Json
          formulario_id: string
          id: string
          publicada: boolean
          publicada_at: string | null
          publicada_por: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          creada_at?: string
          definicion: Json
          formulario_id: string
          id?: string
          publicada?: boolean
          publicada_at?: string | null
          publicada_por?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          creada_at?: string
          definicion?: Json
          formulario_id?: string
          id?: string
          publicada?: boolean
          publicada_at?: string | null
          publicada_por?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "formulario_version_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formulario_levantamiento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_version_publicada_por_fkey"
            columns: ["publicada_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_version_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      foto: {
        Row: {
          capturada_at: string
          creado_at: string
          geo: unknown
          hash: string | null
          id: string
          levantamiento_id: string | null
          subida_at: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_foto"]
          url_r2: string | null
          visita_id: string
        }
        Insert: {
          capturada_at: string
          creado_at?: string
          geo?: unknown
          hash?: string | null
          id?: string
          levantamiento_id?: string | null
          subida_at?: string | null
          tenant_id?: string
          tipo: Database["public"]["Enums"]["tipo_foto"]
          url_r2?: string | null
          visita_id: string
        }
        Update: {
          capturada_at?: string
          creado_at?: string
          geo?: unknown
          hash?: string | null
          id?: string
          levantamiento_id?: string | null
          subida_at?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_foto"]
          url_r2?: string | null
          visita_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "foto_lev_fk"
            columns: ["levantamiento_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "foto_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foto_visita_fk"
            columns: ["visita_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "visita"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      importacion: {
        Row: {
          aplicada_at: string | null
          archivo_hash: string | null
          archivo_url_r2: string | null
          creado_at: string
          errores: Json
          estado: Database["public"]["Enums"]["estado_importacion"]
          id: string
          resumen: Json
          subido_por: string
          tenant_id: string
        }
        Insert: {
          aplicada_at?: string | null
          archivo_hash?: string | null
          archivo_url_r2?: string | null
          creado_at?: string
          errores?: Json
          estado?: Database["public"]["Enums"]["estado_importacion"]
          id?: string
          resumen?: Json
          subido_por: string
          tenant_id: string
        }
        Update: {
          aplicada_at?: string | null
          archivo_hash?: string | null
          archivo_url_r2?: string | null
          creado_at?: string
          errores?: Json
          estado?: Database["public"]["Enums"]["estado_importacion"]
          id?: string
          resumen?: Json
          subido_por?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "importacion_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacion_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      levantamiento: {
        Row: {
          creado_at: string
          estado: Database["public"]["Enums"]["estado_levantamiento"]
          formulario_version_id: string | null
          foto_antes_id: string | null
          foto_despues_id: string | null
          id: string
          marca_id: string
          sos_foto_id: string | null
          sos_frentes_competencia: Json
          sos_frentes_propios: number | null
          tenant_id: string
          visita_id: string
        }
        Insert: {
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_levantamiento"]
          formulario_version_id?: string | null
          foto_antes_id?: string | null
          foto_despues_id?: string | null
          id?: string
          marca_id: string
          sos_foto_id?: string | null
          sos_frentes_competencia?: Json
          sos_frentes_propios?: number | null
          tenant_id?: string
          visita_id: string
        }
        Update: {
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_levantamiento"]
          formulario_version_id?: string | null
          foto_antes_id?: string | null
          foto_despues_id?: string | null
          id?: string
          marca_id?: string
          sos_foto_id?: string | null
          sos_frentes_competencia?: Json
          sos_frentes_propios?: number | null
          tenant_id?: string
          visita_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lev_foto_antes_fk"
            columns: ["foto_antes_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_foto_despues_fk"
            columns: ["foto_despues_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_marca_fk"
            columns: ["marca_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_sos_foto_fk"
            columns: ["sos_foto_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_visita_fk"
            columns: ["visita_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "visita"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "levantamiento_formulario_version_id_fkey"
            columns: ["formulario_version_id"]
            isOneToOne: false
            referencedRelation: "formulario_version"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "levantamiento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      levantamiento_respuesta: {
        Row: {
          campo_id: string
          creado_at: string
          id: string
          levantamiento_id: string
          tenant_id: string
          valor: Json
        }
        Insert: {
          campo_id: string
          creado_at?: string
          id?: string
          levantamiento_id: string
          tenant_id: string
          valor: Json
        }
        Update: {
          campo_id?: string
          creado_at?: string
          id?: string
          levantamiento_id?: string
          tenant_id?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lev_resp_lev_fk"
            columns: ["levantamiento_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "levantamiento_respuesta_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      levantamiento_sku: {
        Row: {
          creado_at: string
          diferencia: boolean | null
          frentes_competencia: Json
          frentes_propios: number | null
          hay_promo: boolean | null
          id: string
          levantamiento_id: string
          precio_registrado: number | null
          promo_comunicada: boolean | null
          quiebre: boolean | null
          sku_id: string
          sos_foto_id: string | null
          stock_piso: number | null
          stock_sistema: number | null
          tenant_id: string
        }
        Insert: {
          creado_at?: string
          diferencia?: boolean | null
          frentes_competencia?: Json
          frentes_propios?: number | null
          hay_promo?: boolean | null
          id?: string
          levantamiento_id: string
          precio_registrado?: number | null
          promo_comunicada?: boolean | null
          quiebre?: boolean | null
          sku_id: string
          sos_foto_id?: string | null
          stock_piso?: number | null
          stock_sistema?: number | null
          tenant_id?: string
        }
        Update: {
          creado_at?: string
          diferencia?: boolean | null
          frentes_competencia?: Json
          frentes_propios?: number | null
          hay_promo?: boolean | null
          id?: string
          levantamiento_id?: string
          precio_registrado?: number | null
          promo_comunicada?: boolean | null
          quiebre?: boolean | null
          sku_id?: string
          sos_foto_id?: string | null
          stock_piso?: number | null
          stock_sistema?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lev_sku_foto_fk"
            columns: ["sos_foto_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_sku_lev_fk"
            columns: ["levantamiento_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "lev_sku_sku_fk"
            columns: ["sku_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "levantamiento_sku_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      mapeo_importacion: {
        Row: {
          creado_at: string
          creado_por: string
          id: string
          mapeo: Json
          nombre: string
          tenant_id: string
        }
        Insert: {
          creado_at?: string
          creado_por: string
          id?: string
          mapeo: Json
          nombre: string
          tenant_id: string
        }
        Update: {
          creado_at?: string
          creado_por?: string
          id?: string
          mapeo?: Json
          nombre?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapeo_importacion_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapeo_importacion_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      marca: {
        Row: {
          activo: boolean
          codigo_externo: string | null
          creado_at: string
          id: string
          logo_url: string | null
          nombre: string
          tenant_id: string
          tolerancia_precio_pct: number
        }
        Insert: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          logo_url?: string | null
          nombre: string
          tenant_id: string
          tolerancia_precio_pct?: number
        }
        Update: {
          activo?: boolean
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          logo_url?: string | null
          nombre?: string
          tenant_id?: string
          tolerancia_precio_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "marca_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      pase_acceso_temporal: {
        Row: {
          codigo_hash: string
          expira_at: string
          generado_at: string
          generado_por: string
          id: string
          motivo: string
          profile_id: string
          revocado_at: string | null
          usado_at: string | null
        }
        Insert: {
          codigo_hash: string
          expira_at?: string
          generado_at?: string
          generado_por: string
          id?: string
          motivo: string
          profile_id: string
          revocado_at?: string | null
          usado_at?: string | null
        }
        Update: {
          codigo_hash?: string
          expira_at?: string
          generado_at?: string
          generado_por?: string
          id?: string
          motivo?: string
          profile_id?: string
          revocado_at?: string | null
          usado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pase_acceso_temporal_generado_por_fkey"
            columns: ["generado_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pase_acceso_temporal_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_modulo_habilitado: {
        Row: {
          creado_at: string
          habilitado: boolean
          id: string
          modulo: Database["public"]["Enums"]["modulo_portal"]
          tenant_id: string
        }
        Insert: {
          creado_at?: string
          habilitado?: boolean
          id?: string
          modulo: Database["public"]["Enums"]["modulo_portal"]
          tenant_id: string
        }
        Update: {
          creado_at?: string
          habilitado?: boolean
          id?: string
          modulo?: Database["public"]["Enums"]["modulo_portal"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_modulo_habilitado_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      precio_regular: {
        Row: {
          cadena_id: string
          creado_at: string
          id: string
          precio: number
          sku_id: string
          tenant_id: string
          tipo_tienda: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde: string
        }
        Insert: {
          cadena_id: string
          creado_at?: string
          id?: string
          precio: number
          sku_id: string
          tenant_id: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde?: string
        }
        Update: {
          cadena_id?: string
          creado_at?: string
          id?: string
          precio?: number
          sku_id?: string
          tenant_id?: string
          tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"] | null
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "precio_cadena_fk"
            columns: ["cadena_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "cadena"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "precio_regular_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precio_sku_fk"
            columns: ["sku_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      profile: {
        Row: {
          activo: boolean
          canal_2fa: Database["public"]["Enums"]["canal_otp"]
          creado_at: string
          desactivado_at: string | null
          dni: string | null
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol_usuario"]
          sctr_vigente_hasta: string | null
          supervisor_id: string | null
          telefono: string | null
          telefono_verificado_at: string | null
          tenant_id: string | null
        }
        Insert: {
          activo?: boolean
          canal_2fa?: Database["public"]["Enums"]["canal_otp"]
          creado_at?: string
          desactivado_at?: string | null
          dni?: string | null
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol_usuario"]
          sctr_vigente_hasta?: string | null
          supervisor_id?: string | null
          telefono?: string | null
          telefono_verificado_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          activo?: boolean
          canal_2fa?: Database["public"]["Enums"]["canal_otp"]
          creado_at?: string
          desactivado_at?: string | null
          dni?: string | null
          id?: string
          nombre?: string
          rol?: Database["public"]["Enums"]["rol_usuario"]
          sctr_vigente_hasta?: string | null
          supervisor_id?: string | null
          telefono?: string | null
          telefono_verificado_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion: {
        Row: {
          clusters: string[]
          comunicada: boolean
          creado_at: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          precio_promo: number
          sku_id: string
          tenant_id: string
        }
        Insert: {
          clusters?: string[]
          comunicada?: boolean
          creado_at?: string
          fecha_fin: string
          fecha_inicio: string
          id?: string
          precio_promo: number
          sku_id: string
          tenant_id: string
        }
        Update: {
          clusters?: string[]
          comunicada?: boolean
          creado_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          precio_promo?: number
          sku_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promocion_sku_fk"
            columns: ["sku_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "promocion_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      puntaje_perfect_store: {
        Row: {
          calculado_at: string
          config_id: string
          distribucion_pct: number | null
          levantamiento_id: string
          precio_pct: number | null
          skus_codificados: number
          skus_evaluados: number
          skus_precio_correctos: number
          skus_precio_evaluados: number
          skus_presentes: number
          sos_real_pct: number | null
          tenant_id: string
          total_pct: number | null
          visibilidad_pct: number | null
        }
        Insert: {
          calculado_at?: string
          config_id: string
          distribucion_pct?: number | null
          levantamiento_id: string
          precio_pct?: number | null
          skus_codificados?: number
          skus_evaluados?: number
          skus_precio_correctos?: number
          skus_precio_evaluados?: number
          skus_presentes?: number
          sos_real_pct?: number | null
          tenant_id: string
          total_pct?: number | null
          visibilidad_pct?: number | null
        }
        Update: {
          calculado_at?: string
          config_id?: string
          distribucion_pct?: number | null
          levantamiento_id?: string
          precio_pct?: number | null
          skus_codificados?: number
          skus_evaluados?: number
          skus_precio_correctos?: number
          skus_precio_evaluados?: number
          skus_presentes?: number
          sos_real_pct?: number | null
          tenant_id?: string
          total_pct?: number | null
          visibilidad_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "puntaje_perfect_store_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "config_perfect_store"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntaje_perfect_store_levantamiento_id_fkey"
            columns: ["levantamiento_id"]
            isOneToOne: true
            referencedRelation: "levantamiento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntaje_perfect_store_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      puntaje_perfect_store_categoria: {
        Row: {
          calculado_at: string
          categoria_id: string
          config_id: string
          distribucion_pct: number | null
          levantamiento_id: string
          precio_pct: number | null
          skus_codificados: number
          skus_evaluados: number
          skus_precio_correctos: number
          skus_precio_evaluados: number
          skus_presentes: number
          tenant_id: string
          total_pct: number | null
        }
        Insert: {
          calculado_at?: string
          categoria_id: string
          config_id: string
          distribucion_pct?: number | null
          levantamiento_id: string
          precio_pct?: number | null
          skus_codificados?: number
          skus_evaluados?: number
          skus_precio_correctos?: number
          skus_precio_evaluados?: number
          skus_presentes?: number
          tenant_id: string
          total_pct?: number | null
        }
        Update: {
          calculado_at?: string
          categoria_id?: string
          config_id?: string
          distribucion_pct?: number | null
          levantamiento_id?: string
          precio_pct?: number | null
          skus_codificados?: number
          skus_evaluados?: number
          skus_precio_correctos?: number
          skus_precio_evaluados?: number
          skus_presentes?: number
          tenant_id?: string
          total_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "puntaje_perfect_store_categoria_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categoria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntaje_perfect_store_categoria_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "config_perfect_store"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntaje_perfect_store_categoria_levantamiento_id_fkey"
            columns: ["levantamiento_id"]
            isOneToOne: false
            referencedRelation: "levantamiento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntaje_perfect_store_categoria_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_visita: {
        Row: {
          creado_at: string
          decision: Database["public"]["Enums"]["decision_revision"]
          id: string
          motivo: string | null
          revisado_at: string
          revisor_id: string
          tenant_id: string
          visita_id: string
        }
        Insert: {
          creado_at?: string
          decision: Database["public"]["Enums"]["decision_revision"]
          id?: string
          motivo?: string | null
          revisado_at?: string
          revisor_id: string
          tenant_id: string
          visita_id: string
        }
        Update: {
          creado_at?: string
          decision?: Database["public"]["Enums"]["decision_revision"]
          id?: string
          motivo?: string | null
          revisado_at?: string
          revisor_id?: string
          tenant_id?: string
          visita_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_visita_fk"
            columns: ["visita_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "visita"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "revision_visita_revisor_id_fkey"
            columns: ["revisor_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revision_visita_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      rutero: {
        Row: {
          creado_at: string
          estado: Database["public"]["Enums"]["estado_rutero"]
          fecha: string
          id: string
          mercaderista_id: string
          tenant_id: string
        }
        Insert: {
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_rutero"]
          fecha: string
          id?: string
          mercaderista_id: string
          tenant_id: string
        }
        Update: {
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_rutero"]
          fecha?: string
          id?: string
          mercaderista_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rutero_mercaderista_id_fkey"
            columns: ["mercaderista_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rutero_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      rutero_parada: {
        Row: {
          estado: Database["public"]["Enums"]["estado_parada"]
          hora_planificada: string | null
          id: string
          orden: number
          rutero_id: string
          tenant_id: string
          tienda_id: string
        }
        Insert: {
          estado?: Database["public"]["Enums"]["estado_parada"]
          hora_planificada?: string | null
          id?: string
          orden: number
          rutero_id: string
          tenant_id: string
          tienda_id: string
        }
        Update: {
          estado?: Database["public"]["Enums"]["estado_parada"]
          hora_planificada?: string | null
          id?: string
          orden?: number
          rutero_id?: string
          tenant_id?: string
          tienda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parada_rutero_fk"
            columns: ["rutero_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "rutero"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "parada_tienda_fk"
            columns: ["tienda_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tienda"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "rutero_parada_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      sku: {
        Row: {
          activo: boolean
          categoria_id: string | null
          codigo: string
          codigo_barras: string | null
          codigo_externo: string | null
          creado_at: string
          id: string
          marca_id: string
          nombre: string
          presentacion: string | null
          tenant_id: string
        }
        Insert: {
          activo?: boolean
          categoria_id?: string | null
          codigo: string
          codigo_barras?: string | null
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          marca_id: string
          nombre: string
          presentacion?: string | null
          tenant_id: string
        }
        Update: {
          activo?: boolean
          categoria_id?: string | null
          codigo?: string
          codigo_barras?: string | null
          codigo_externo?: string | null
          creado_at?: string
          id?: string
          marca_id?: string
          nombre?: string
          presentacion?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_categoria_fk"
            columns: ["categoria_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "categoria"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sku_marca_fk"
            columns: ["marca_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "marca"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sku_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitud_cambio_ruta: {
        Row: {
          comentario_resolucion: string | null
          creada_at: string
          estado: Database["public"]["Enums"]["estado_solicitud_ruta"]
          fecha: string | null
          id: string
          mercaderista_id: string
          motivo: string
          resuelta_at: string | null
          resuelta_por: string | null
          rutero_id: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_solicitud_ruta"]
        }
        Insert: {
          comentario_resolucion?: string | null
          creada_at?: string
          estado?: Database["public"]["Enums"]["estado_solicitud_ruta"]
          fecha?: string | null
          id?: string
          mercaderista_id: string
          motivo: string
          resuelta_at?: string | null
          resuelta_por?: string | null
          rutero_id?: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["tipo_solicitud_ruta"]
        }
        Update: {
          comentario_resolucion?: string | null
          creada_at?: string
          estado?: Database["public"]["Enums"]["estado_solicitud_ruta"]
          fecha?: string | null
          id?: string
          mercaderista_id?: string
          motivo?: string
          resuelta_at?: string | null
          resuelta_por?: string | null
          rutero_id?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["tipo_solicitud_ruta"]
        }
        Relationships: [
          {
            foreignKeyName: "solicitud_cambio_ruta_mercaderista_id_fkey"
            columns: ["mercaderista_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_cambio_ruta_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_cambio_ruta_rutero_id_fkey"
            columns: ["rutero_id"]
            isOneToOne: false
            referencedRelation: "rutero"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_cambio_ruta_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant: {
        Row: {
          activo: boolean
          creado_at: string
          id: string
          nombre: string
          tolerancia_puntualidad_min: number
        }
        Insert: {
          activo?: boolean
          creado_at?: string
          id?: string
          nombre: string
          tolerancia_puntualidad_min?: number
        }
        Update: {
          activo?: boolean
          creado_at?: string
          id?: string
          nombre?: string
          tolerancia_puntualidad_min?: number
        }
        Relationships: []
      }
      tienda: {
        Row: {
          activo: boolean
          cadena_id: string
          cluster: string | null
          codigo_externo: string | null
          creado_at: string
          direccion: string | null
          id: string
          lat: number | null
          lon: number | null
          nombre: string
          radio_geocerca_m: number
          tenant_id: string
          ubicacion: unknown
        }
        Insert: {
          activo?: boolean
          cadena_id: string
          cluster?: string | null
          codigo_externo?: string | null
          creado_at?: string
          direccion?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          nombre: string
          radio_geocerca_m?: number
          tenant_id: string
          ubicacion?: unknown
        }
        Update: {
          activo?: boolean
          cadena_id?: string
          cluster?: string | null
          codigo_externo?: string | null
          creado_at?: string
          direccion?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          nombre?: string
          radio_geocerca_m?: number
          tenant_id?: string
          ubicacion?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "tienda_cadena_fk"
            columns: ["cadena_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "cadena"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "tienda_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
        ]
      }
      tienda_sku: {
        Row: {
          activo: boolean
          sku_id: string
          tenant_id: string
          tienda_id: string
        }
        Insert: {
          activo?: boolean
          sku_id: string
          tenant_id: string
          tienda_id: string
        }
        Update: {
          activo?: boolean
          sku_id?: string
          tenant_id?: string
          tienda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tienda_sku_sku_fk"
            columns: ["sku_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "tienda_sku_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tienda_sku_tienda_fk"
            columns: ["tienda_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tienda"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      visita: {
        Row: {
          bateria_inicio_pct: number | null
          bitacora: string | null
          check_in_at: string
          check_in_geo: unknown
          check_in_geocerca_ok: boolean | null
          check_in_recibido_at: string
          check_out_at: string | null
          check_out_geo: unknown
          check_out_geocerca_ok: boolean | null
          check_out_recibido_at: string | null
          creado_at: string
          estado: Database["public"]["Enums"]["estado_visita"]
          id: string
          mercaderista_id: string
          rutero_parada_id: string
          selfie_foto_id: string | null
          tenant_id: string
          tiempo_traslado_min: number | null
          tienda_id: string
        }
        Insert: {
          bateria_inicio_pct?: number | null
          bitacora?: string | null
          check_in_at?: string
          check_in_geo?: unknown
          check_in_geocerca_ok?: boolean | null
          check_in_recibido_at?: string
          check_out_at?: string | null
          check_out_geo?: unknown
          check_out_geocerca_ok?: boolean | null
          check_out_recibido_at?: string | null
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_visita"]
          id?: string
          mercaderista_id: string
          rutero_parada_id: string
          selfie_foto_id?: string | null
          tenant_id?: string
          tiempo_traslado_min?: number | null
          tienda_id: string
        }
        Update: {
          bateria_inicio_pct?: number | null
          bitacora?: string | null
          check_in_at?: string
          check_in_geo?: unknown
          check_in_geocerca_ok?: boolean | null
          check_in_recibido_at?: string
          check_out_at?: string | null
          check_out_geo?: unknown
          check_out_geocerca_ok?: boolean | null
          check_out_recibido_at?: string | null
          creado_at?: string
          estado?: Database["public"]["Enums"]["estado_visita"]
          id?: string
          mercaderista_id?: string
          rutero_parada_id?: string
          selfie_foto_id?: string | null
          tenant_id?: string
          tiempo_traslado_min?: number | null
          tienda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visita_mercaderista_id_fkey"
            columns: ["mercaderista_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visita_parada_fk"
            columns: ["rutero_parada_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "rutero_parada"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "visita_selfie_fk"
            columns: ["selfie_foto_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "foto"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "visita_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visita_tienda_fk"
            columns: ["tienda_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tienda"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agregar_parada_rutero: {
        Args: { p_fecha: string; p_mercaderista: string; p_tienda: string }
        Returns: string
      }
      aplicar_importacion: {
        Args: { p_importacion_id: string; p_lote: Json }
        Returns: Json
      }
      bandeja_alertas: {
        Args: {
          p_cadena?: string
          p_desde: string
          p_estado?: Database["public"]["Enums"]["estado_alerta"]
          p_hasta: string
          p_pagina?: number
          p_por_pagina?: number
          p_severidad?: Database["public"]["Enums"]["severidad_alerta"]
          p_tienda?: string
          p_tipo?: Database["public"]["Enums"]["tipo_alerta"]
        }
        Returns: {
          cadena_nombre: string
          creado_at: string
          estado: Database["public"]["Enums"]["estado_alerta"]
          id: string
          marca_nombre: string
          severidad: Database["public"]["Enums"]["severidad_alerta"]
          sku_codigo: string
          sku_nombre: string
          tienda_nombre: string
          tipo: Database["public"]["Enums"]["tipo_alerta"]
          total: number
        }[]
      }
      bandeja_solicitudes: {
        Args: { p_solo_mi_equipo?: boolean }
        Returns: {
          comentario_resolucion: string
          creada_at: string
          estado: Database["public"]["Enums"]["estado_solicitud_ruta"]
          fecha: string
          id: string
          mercaderista_id: string
          mercaderista_nombre: string
          motivo: string
          resuelta_at: string
          resuelta_por_nombre: string
          rutero_fecha: string
          tipo: Database["public"]["Enums"]["tipo_solicitud_ruta"]
        }[]
      }
      bitacora_pases: {
        Args: {
          p_estado?: Database["public"]["Enums"]["estado_pase"]
          p_limite?: number
          p_profile_id?: string
        }
        Returns: {
          emisor_nombre: string
          estado: Database["public"]["Enums"]["estado_pase"]
          expira_at: string
          generado_at: string
          id: string
          motivo: string
          profile_id: string
          usuario_nombre: string
        }[]
      }
      cola_revision: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          cadena_nombre: string
          check_in_at: string
          check_in_geocerca_ok: boolean
          check_out_at: string
          check_out_geocerca_ok: boolean
          contingencias: number
          decision: Database["public"]["Enums"]["decision_revision"]
          duracion_min: number
          fotos: number
          fotos_pendientes: number
          marcas: number
          mercaderista_id: string
          mercaderista_nombre: string
          motivo: string
          omitidos: number
          quiebres: number
          revisado_at: string
          revisor_nombre: string
          tienda_nombre: string
          visita_id: string
        }[]
      }
      correos_clientes_del_tenant: {
        Args: { p_tenant: string }
        Returns: {
          correo: string
        }[]
      }
      dashboard_alertas: {
        Args: {
          p_cadena?: string
          p_desde: string
          p_hasta: string
          p_tienda?: string
        }
        Returns: {
          creado_at: string
          id: string
          severidad: Database["public"]["Enums"]["severidad_alerta"]
          tienda_nombre: string
          tipo: Database["public"]["Enums"]["tipo_alerta"]
        }[]
      }
      dashboard_kpis: {
        Args: {
          p_cadena?: string
          p_desde: string
          p_hasta: string
          p_tienda?: string
        }
        Returns: {
          cumplimiento_pct: number
          cumplimiento_pct_prev: number
          desviaciones_precio: number
          desviaciones_precio_prev: number
          diferencias: number
          diferencias_prev: number
          exhib_cumplidas: number
          exhib_cumplidas_prev: number
          exhib_negociadas: number
          exhib_negociadas_prev: number
          quiebres: number
          quiebres_prev: number
          sos_pct: number
          sos_pct_prev: number
        }[]
      }
      dashboard_pines: {
        Args: {
          p_cadena?: string
          p_desde: string
          p_hasta: string
          p_tienda?: string
        }
        Returns: {
          id: string
          lat: number
          lon: number
          nombre: string
          tiene_alerta: boolean
          ultima_visita_estado: string
          visitada: boolean
        }[]
      }
      detalle_alerta: { Args: { p_alerta_id: string }; Returns: Json }
      detalle_visita: { Args: { p_visita_id: string }; Returns: Json }
      duplicar_periodo_rutero: {
        Args: {
          p_desde: string
          p_dias_desplazamiento: number
          p_hasta: string
          p_mercaderista: string
        }
        Returns: number
      }
      fijar_hora_parada: {
        Args: { p_hora?: string; p_parada: string }
        Returns: undefined
      }
      foto_del_levantamiento: {
        Args: {
          p_filtro: Database["public"]["Enums"]["tipo_foto"]
          p_levantamiento: string
          p_tipo: Database["public"]["Enums"]["tipo_foto"]
          p_visita: string
        }
        Returns: Json
      }
      galeria_evidencia: {
        Args: {
          p_cadena?: string
          p_desde: string
          p_hasta: string
          p_tienda?: string
          p_tipo?: Database["public"]["Enums"]["tipo_foto"]
          p_tope_visitas?: number
        }
        Returns: Json
      }
      perfect_store_agregado: {
        Args: {
          p_cadena?: string
          p_categoria?: string
          p_desde: string
          p_hasta: string
          p_marca?: string
          p_mercaderista?: string
          p_tienda?: string
          p_tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"]
        }
        Returns: {
          distribucion_pct: number
          levantamientos: number
          precio_pct: number
          total_pct: number
          visibilidad_pct: number
        }[]
      }
      perfect_store_desglose: {
        Args: {
          p_cadena?: string
          p_categoria?: string
          p_desde: string
          p_hasta: string
          p_marca?: string
          p_nivel: Database["public"]["Enums"]["nivel_perfect_store"]
          p_tienda?: string
          p_tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"]
        }
        Returns: {
          clave: string
          distribucion_pct: number
          etiqueta: string
          levantamientos: number
          precio_pct: number
          total_pct: number
          visibilidad_pct: number
        }[]
      }
      perfect_store_serie: {
        Args: {
          p_cadena?: string
          p_categoria?: string
          p_desde: string
          p_granularidad?: Database["public"]["Enums"]["granularidad_serie"]
          p_hasta: string
          p_marca?: string
          p_tienda?: string
          p_tipo_tienda?: Database["public"]["Enums"]["tipo_tienda"]
        }
        Returns: {
          levantamientos: number
          periodo: string
          total_pct: number
        }[]
      }
      planeacion_ruteros: {
        Args: { p_desde: string; p_hasta: string; p_mercaderista: string }
        Returns: {
          estado: Database["public"]["Enums"]["estado_rutero"]
          fecha: string
          hora_planificada: string
          orden: number
          parada_estado: Database["public"]["Enums"]["estado_parada"]
          parada_id: string
          rutero_id: string
          tienda_id: string
          tienda_nombre: string
        }[]
      }
      portal_modulos: {
        Args: never
        Returns: {
          habilitado: boolean
          modulo: Database["public"]["Enums"]["modulo_portal"]
        }[]
      }
      puntualidad_paradas: {
        Args: { p_desde: string; p_hasta: string; p_mercaderista: string }
        Returns: {
          asistencia: Database["public"]["Enums"]["asistencia_parada"]
          check_in_at: string
          dentro_tolerancia: boolean
          fecha: string
          hora_planificada: string
          minutos_desvio: number
          parada_id: string
          rutero_id: string
          tienda_id: string
        }[]
      }
      reordenar_paradas: {
        Args: { p_paradas: string[]; p_rutero_id: string }
        Returns: undefined
      }
      revisar_visita: {
        Args: {
          p_decision: Database["public"]["Enums"]["decision_revision"]
          p_motivo: string
          p_visita_id: string
        }
        Returns: string
      }
      tablero_contingencias: {
        Args: { p_fecha: string }
        Returns: {
          creado_at: string
          estado: Database["public"]["Enums"]["estado_alerta"]
          id: string
          mercaderista_nombre: string
          motivo: string
          paso: string
          tienda_nombre: string
          visita_id: string
        }[]
      }
      tablero_dia: {
        Args: { p_fecha: string }
        Returns: {
          bateria_inicio_pct: number
          check_in_at: string
          check_out_at: string
          duracion_min: number
          estado: Database["public"]["Enums"]["estado_visita"]
          fotos: number
          mercaderista_dni: string
          mercaderista_nombre: string
          motivo: string
          tiempo_traslado_min: number
          tienda_id: string
          tienda_lat: number
          tienda_lon: number
          tienda_nombre: string
          visita_id: string
        }[]
      }
    }
    Enums: {
      asistencia_parada: "pendiente" | "asistio" | "falto"
      canal_alerta: "dashboard" | "email" | "whatsapp"
      canal_otp: "correo" | "sms" | "whatsapp"
      decision_revision: "aprobada" | "rechazada"
      estado_alerta: "nueva" | "vista" | "resuelta"
      estado_importacion:
        | "validando"
        | "con_errores"
        | "previsualizada"
        | "aplicada"
        | "cancelada"
      estado_levantamiento: "pendiente" | "en_curso" | "completado" | "omitido"
      estado_parada: "pendiente" | "en_curso" | "completada"
      estado_pase: "vigente" | "usado" | "vencido" | "revocado"
      estado_rutero: "borrador" | "publicado" | "en_curso" | "completado"
      estado_solicitud_ruta: "nueva" | "vista" | "resuelta" | "rechazada"
      estado_visita: "en_curso" | "completada" | "bloqueada"
      evaluacion_precio:
        | "sin_precio_vigente"
        | "correcto"
        | "sobreprecio"
        | "promo_no_comunicada"
        | "subvaluado_sin_promo"
      granularidad_serie: "dia" | "semana" | "mes"
      modulo_portal:
        | "dashboard"
        | "mapa"
        | "galeria"
        | "alertas"
        | "reportes"
        | "perfect_store"
      nivel_perfect_store: "categoria" | "tipo_tienda" | "cadena" | "tienda"
      paso_levantamiento:
        | "checkin"
        | "foto_antes"
        | "share_of_shelf"
        | "quiebres"
        | "precios"
        | "exhibiciones"
        | "foto_despues"
        | "checkout"
        | "campos_extra"
      politica_pop: "dentro_del_tope" | "bonus_sobre_100"
      rol_usuario: "admin" | "supervisor" | "mercaderista" | "cliente"
      severidad_alerta: "info" | "alta" | "critica"
      tipo_alerta:
        | "quiebre"
        | "diferencia_stock"
        | "desviacion_precio"
        | "promo_no_activa"
        | "exhibicion_incompleta"
        | "contingencia"
      tipo_exhibicion: "cabecera" | "isla" | "ruma" | "pop" | "adicional"
      tipo_foto:
        | "selfie"
        | "antes"
        | "despues"
        | "sos"
        | "exhibicion"
        | "precio"
        | "contingencia"
        | "campo_extra"
      tipo_solicitud_ruta: "cambio_tienda" | "cambio_dia" | "no_visita" | "otro"
      tipo_tienda: "hiper" | "super" | "express"
      unidad_sos: "frentes" | "centimetros"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      asistencia_parada: ["pendiente", "asistio", "falto"],
      canal_alerta: ["dashboard", "email", "whatsapp"],
      canal_otp: ["correo", "sms", "whatsapp"],
      decision_revision: ["aprobada", "rechazada"],
      estado_alerta: ["nueva", "vista", "resuelta"],
      estado_importacion: [
        "validando",
        "con_errores",
        "previsualizada",
        "aplicada",
        "cancelada",
      ],
      estado_levantamiento: ["pendiente", "en_curso", "completado", "omitido"],
      estado_parada: ["pendiente", "en_curso", "completada"],
      estado_pase: ["vigente", "usado", "vencido", "revocado"],
      estado_rutero: ["borrador", "publicado", "en_curso", "completado"],
      estado_solicitud_ruta: ["nueva", "vista", "resuelta", "rechazada"],
      estado_visita: ["en_curso", "completada", "bloqueada"],
      evaluacion_precio: [
        "sin_precio_vigente",
        "correcto",
        "sobreprecio",
        "promo_no_comunicada",
        "subvaluado_sin_promo",
      ],
      granularidad_serie: ["dia", "semana", "mes"],
      modulo_portal: [
        "dashboard",
        "mapa",
        "galeria",
        "alertas",
        "reportes",
        "perfect_store",
      ],
      nivel_perfect_store: ["categoria", "tipo_tienda", "cadena", "tienda"],
      paso_levantamiento: [
        "checkin",
        "foto_antes",
        "share_of_shelf",
        "quiebres",
        "precios",
        "exhibiciones",
        "foto_despues",
        "checkout",
        "campos_extra",
      ],
      politica_pop: ["dentro_del_tope", "bonus_sobre_100"],
      rol_usuario: ["admin", "supervisor", "mercaderista", "cliente"],
      severidad_alerta: ["info", "alta", "critica"],
      tipo_alerta: [
        "quiebre",
        "diferencia_stock",
        "desviacion_precio",
        "promo_no_activa",
        "exhibicion_incompleta",
        "contingencia",
      ],
      tipo_exhibicion: ["cabecera", "isla", "ruma", "pop", "adicional"],
      tipo_foto: [
        "selfie",
        "antes",
        "despues",
        "sos",
        "exhibicion",
        "precio",
        "contingencia",
        "campo_extra",
      ],
      tipo_solicitud_ruta: ["cambio_tienda", "cambio_dia", "no_visita", "otro"],
      tipo_tienda: ["hiper", "super", "express"],
      unidad_sos: ["frentes", "centimetros"],
    },
  },
} as const

