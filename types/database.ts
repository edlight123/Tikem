export type UserRole = 'attendee' | 'organizer' | 'admin' | 'super_admin'

export type TicketStatus = 'active' | 'used' | 'cancelled'

export type ScanResult = 'valid' | 'already_used' | 'invalid'

export type NotificationType = 
  // Discretionary notifications (see lib/notifications/policy.ts) — these obey
  // quiet hours, per-category opt-outs and once-ever caps.
  | 'event_filling_fast'
  | 'city_discovery'
  | 'organizer_milestone'
  | 'organizer_nudge'
  | 'ticket_purchased' 
  | 'ticket_transfer'
  | 'event_updated' 
  | 'event_reminder_24h' 
  | 'event_reminder_3h' 
  | 'event_reminder_30min'
  | 'event_cancelled'
  | 'verification'
  | 'staff_invite'
  | 'verification_submitted'
  | 'verification_approved'
  | 'verification_rejected'
  | 'verification_info_needed'
  | 'connection_request'
  | 'connection_accepted'
  | 'organizer_message'
  | 'organizer_reply'
  | 'payment_dispute'
  // An organizer's payout account can no longer take money for a LIVE event.
  // Transactional: it is about their own money and is never suppressed.
  | 'payout_account_blocked'

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          full_name: string
          email: string
          phone_number: string | null
          role: UserRole
          is_verified: boolean
          verification_status: 'none' | 'pending' | 'approved' | 'rejected'
          notify_ticket_purchase: boolean
          notify_event_updates: boolean
          notify_reminders: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          phone_number?: string | null
          role?: UserRole
          is_verified?: boolean
          verification_status?: 'none' | 'pending' | 'approved' | 'rejected'
          notify_ticket_purchase?: boolean
          notify_event_updates?: boolean
          notify_reminders?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone_number?: string | null
          role?: UserRole
          is_verified?: boolean
          verification_status?: 'none' | 'pending' | 'approved' | 'rejected'
          notify_ticket_purchase?: boolean
          notify_event_updates?: boolean
          notify_reminders?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      verification_requests: {
        Row: {
          id: string
          user_id: string
          id_front_url: string
          id_back_url: string
          face_photo_url: string
          status: 'pending' | 'approved' | 'rejected'
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          id_front_url: string
          id_back_url: string
          face_photo_url: string
          status?: 'pending' | 'approved' | 'rejected'
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          id_front_url?: string
          id_back_url?: string
          face_photo_url?: string
          status?: 'pending' | 'approved' | 'rejected'
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      events: {
        Row: {
          id: string
          organizer_id: string
          title: string
          description: string
          category: string
          venue_name: string
          country: string
          city: string
          commune: string
          address: string
          start_datetime: string
          end_datetime: string
          banner_image_url: string | null
          ticket_price: number
          currency: string
          total_tickets: number
          tickets_sold: number
          is_published: boolean
          tags: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organizer_id: string
          title: string
          description: string
          category: string
          venue_name: string
          country: string
          city: string
          commune: string
          address: string
          start_datetime: string
          end_datetime: string
          banner_image_url?: string | null
          ticket_price: number
          currency?: string
          total_tickets: number
          tickets_sold?: number
          is_published?: boolean
          tags?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organizer_id?: string
          title?: string
          description?: string
          category?: string
          venue_name?: string
          country?: string
          city?: string
          commune?: string
          address?: string
          start_datetime?: string
          end_datetime?: string
          banner_image_url?: string | null
          ticket_price?: number
          currency?: string
          total_tickets?: number
          tickets_sold?: number
          is_published?: boolean
          tags?: string[] | null
          created_at?: string
          updated_at?: string
        }
      }
      tickets: {
        Row: {
          id: string
          event_id: string
          attendee_id: string
          qr_code_data: string
          status: TicketStatus
          price_paid: number
          purchased_at: string
        }
        Insert: {
          id?: string
          event_id: string
          attendee_id: string
          qr_code_data: string
          status?: TicketStatus
          price_paid: number
          purchased_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          attendee_id?: string
          qr_code_data?: string
          status?: TicketStatus
          price_paid?: number
          purchased_at?: string
        }
      }
      ticket_scans: {
        Row: {
          id: string
          ticket_id: string
          event_id: string
          scanned_by: string
          scanned_at: string
          result: ScanResult
        }
        Insert: {
          id?: string
          ticket_id: string
          event_id: string
          scanned_by: string
          scanned_at?: string
          result: ScanResult
        }
        Update: {
          id?: string
          ticket_id?: string
          event_id?: string
          scanned_by?: string
          scanned_at?: string
          result?: ScanResult
        }
      }
      event_favorites: {
        Row: {
          id: string
          user_id: string
          event_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_id?: string
          created_at?: string
        }
      }
      organizer_follows: {
        Row: {
          id: string
          follower_id: string
          organizer_id: string
          created_at: string
        }
        Insert: {
          id?: string
          follower_id: string
          organizer_id: string
          created_at?: string
        }
        Update: {
          id?: string
          follower_id?: string
          organizer_id?: string
          created_at?: string
        }
      }
      event_reviews: {
        Row: {
          id: string
          event_id: string
          user_id: string
          rating: number
          review_text: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          rating: number
          review_text?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          rating?: number
          review_text?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      event_photos: {
        Row: {
          id: string
          event_id: string
          uploaded_by: string
          photo_url: string
          caption: string | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          uploaded_by: string
          photo_url: string
          caption?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          uploaded_by?: string
          photo_url?: string
          caption?: string | null
          created_at?: string
        }
      }
      ticket_transfers: {
        Row: {
          id: string
          ticket_id: string
          from_user_id: string
          to_user_id: string
          transferred_at: string
          transfer_reason: string | null
          ip_address: string | null
        }
        Insert: {
          id?: string
          ticket_id: string
          from_user_id: string
          to_user_id: string
          transferred_at?: string
          transfer_reason?: string | null
          ip_address?: string | null
        }
        Update: {
          id?: string
          ticket_id?: string
          from_user_id?: string
          to_user_id?: string
          transferred_at?: string
          transfer_reason?: string | null
          ip_address?: string | null
        }
      }
      purchase_attempts: {
        Row: {
          id: string
          user_id: string | null
          event_id: string
          ip_address: string
          attempted_at: string
          success: boolean
          quantity: number
          fingerprint: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          event_id: string
          ip_address: string
          attempted_at?: string
          success?: boolean
          quantity: number
          fingerprint?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          event_id?: string
          ip_address?: string
          attempted_at?: string
          success?: boolean
          quantity?: number
          fingerprint?: string | null
        }
      }
      security_blacklist: {
        Row: {
          id: string
          type: 'user' | 'ip' | 'email'
          value: string
          reason: string
          blacklisted_by: string | null
          blacklisted_at: string
          expires_at: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          type: 'user' | 'ip' | 'email'
          value: string
          reason: string
          blacklisted_by?: string | null
          blacklisted_at?: string
          expires_at?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          type?: 'user' | 'ip' | 'email'
          value?: string
          reason?: string
          blacklisted_by?: string | null
          blacklisted_at?: string
          expires_at?: string | null
          notes?: string | null
        }
      }
      suspicious_activities: {
        Row: {
          id: string
          user_id: string | null
          activity_type: 'rapid_purchases' | 'duplicate_tickets' | 'unusual_location' | 'bot_behavior' | 'chargeback' | 'multiple_accounts'
          description: string
          severity: 'low' | 'medium' | 'high' | 'critical'
          ip_address: string | null
          metadata: string | null
          detected_at: string
          reviewed: boolean
          reviewed_by: string | null
          reviewed_at: string | null
          action_taken: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          activity_type: 'rapid_purchases' | 'duplicate_tickets' | 'unusual_location' | 'bot_behavior' | 'chargeback' | 'multiple_accounts'
          description: string
          severity: 'low' | 'medium' | 'high' | 'critical'
          ip_address?: string | null
          metadata?: string | null
          detected_at?: string
          reviewed?: boolean
          reviewed_by?: string | null
          reviewed_at?: string | null
          action_taken?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          activity_type?: 'rapid_purchases' | 'duplicate_tickets' | 'unusual_location' | 'bot_behavior' | 'chargeback' | 'multiple_accounts'
          description?: string
          severity?: 'low' | 'medium' | 'high' | 'critical'
          ip_address?: string | null
          metadata?: string | null
          detected_at?: string
          reviewed?: boolean
          reviewed_by?: string | null
          reviewed_at?: string | null
          action_taken?: string | null
        }
      }
      ticket_tiers: {
        Row: {
          id: string
          event_id: string
          name: string
          description: string | null
          price: number
          total_quantity: number
          sold_quantity: number
          sort_order: number
          is_active: boolean
          sales_start: string | null
          sales_end: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          name: string
          description?: string | null
          price: number
          total_quantity: number
          sold_quantity?: number
          sort_order?: number
          is_active?: boolean
          sales_start?: string | null
          sales_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          name?: string
          description?: string | null
          price?: number
          total_quantity?: number
          sold_quantity?: number
          sort_order?: number
          is_active?: boolean
          sales_start?: string | null
          sales_end?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
