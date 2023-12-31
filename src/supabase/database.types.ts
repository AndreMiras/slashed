export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: Json;
          extensions?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      blocks: {
        Row: {
          chain_id: number;
          height: number;
          id: number;
          time: string | null;
        };
        Insert: {
          chain_id: number;
          height: number;
          id?: never;
          time?: string | null;
        };
        Update: {
          chain_id?: number;
          height?: number;
          id?: never;
          time?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_chain_id_fkey";
            columns: ["chain_id"];
            referencedRelation: "chains";
            referencedColumns: ["id"];
          },
        ];
      };
      chains: {
        Row: {
          id: number;
          name: string;
        };
        Insert: {
          id?: number;
          name: string;
        };
        Update: {
          id?: number;
          name?: string;
        };
        Relationships: [];
      };
      slashing_events: {
        Row: {
          address: string;
          block_height: number;
          chain_id: number;
          id: number;
          power: number;
          reason: string;
        };
        Insert: {
          address: string;
          block_height: number;
          chain_id: number;
          id?: number;
          power: number;
          reason: string;
        };
        Update: {
          address?: string;
          block_height?: number;
          chain_id?: number;
          id?: number;
          power?: number;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "slashing_events_address_fkey";
            columns: ["address"];
            referencedRelation: "validators";
            referencedColumns: ["valcons_address"];
          },
          {
            foreignKeyName: "slashing_events_chain_id_block_height_fkey";
            columns: ["chain_id", "block_height"];
            referencedRelation: "blocks";
            referencedColumns: ["chain_id", "height"];
          },
          {
            foreignKeyName: "slashing_events_chain_id_fkey";
            columns: ["chain_id"];
            referencedRelation: "chains";
            referencedColumns: ["id"];
          },
        ];
      };
      sync_statuses: {
        Row: {
          block_height: number;
          chain_id: number;
          id: number;
        };
        Insert: {
          block_height: number;
          chain_id: number;
          id?: number;
        };
        Update: {
          block_height?: number;
          chain_id?: number;
          id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sync_statuses_chain_id_fkey";
            columns: ["chain_id"];
            referencedRelation: "chains";
            referencedColumns: ["id"];
          },
        ];
      };
      validators: {
        Row: {
          account_address: string;
          chain_id: number;
          consensus_pubkey: string;
          id: number;
          moniker: string;
          valcons_address: string | null;
          valoper_address: string;
        };
        Insert: {
          account_address: string;
          chain_id: number;
          consensus_pubkey: string;
          id?: never;
          moniker: string;
          valcons_address?: string | null;
          valoper_address: string;
        };
        Update: {
          account_address?: string;
          chain_id?: number;
          consensus_pubkey?: string;
          id?: never;
          moniker?: string;
          valcons_address?: string | null;
          valoper_address?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validators_chain_id_fkey";
            columns: ["chain_id"];
            referencedRelation: "chains";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null;
          avif_autodetection: boolean | null;
          created_at: string | null;
          file_size_limit: number | null;
          id: string;
          name: string;
          owner: string | null;
          public: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id: string;
          name: string;
          owner?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id?: string;
          name?: string;
          owner?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "buckets_owner_fkey";
            columns: ["owner"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      migrations: {
        Row: {
          executed_at: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Insert: {
          executed_at?: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Update: {
          executed_at?: string | null;
          hash?: string;
          id?: number;
          name?: string;
        };
        Relationships: [];
      };
      objects: {
        Row: {
          bucket_id: string | null;
          created_at: string | null;
          id: string;
          last_accessed_at: string | null;
          metadata: Json | null;
          name: string | null;
          owner: string | null;
          path_tokens: string[] | null;
          updated_at: string | null;
          version: string | null;
        };
        Insert: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          version?: string | null;
        };
        Update: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          version?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey";
            columns: ["bucket_id"];
            referencedRelation: "buckets";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string;
          name: string;
          owner: string;
          metadata: Json;
        };
        Returns: undefined;
      };
      extension: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      filename: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      foldername: {
        Args: {
          name: string;
        };
        Returns: unknown;
      };
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>;
        Returns: {
          size: number;
          bucket_id: string;
        }[];
      };
      search: {
        Args: {
          prefix: string;
          bucketname: string;
          limits?: number;
          levels?: number;
          offsets?: number;
          search?: string;
          sortcolumn?: string;
          sortorder?: string;
        };
        Returns: {
          name: string;
          id: string;
          updated_at: string;
          created_at: string;
          last_accessed_at: string;
          metadata: Json;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
