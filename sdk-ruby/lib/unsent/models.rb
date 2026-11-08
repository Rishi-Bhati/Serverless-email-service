# frozen_string_literal: true

module Unsent
  EMAIL_STATUSES = %w[queued sending sent failed].freeze
  SORT_ORDERS = %w[updated_at_desc updated_at_asc created_at_desc created_at_asc attempts_desc].freeze
  # After this many delivery attempts the service stops retrying a failed email.
  MAX_DELIVERY_ATTEMPTS = 3

  # Result of {Emails#send_email}.
  #
  # @!attribute id [Integer] email id; use with {Emails#get} / {Emails#wait}
  # @!attribute status [String] "queued" for a new email; the current status when this was an idempotent replay
  # @!attribute idempotency_key [String, nil] the key used (yours or the generated one); nil when idempotency was disabled
  # @!attribute idempotent_replay [Boolean] true when the key matched an email already queued (no new email created)
  # @!attribute target_provider [String] provider name the server targeted, or "Automatic Priority / Default"
  # @!attribute message [String]
  SendResult = Struct.new(:id, :status, :idempotency_key, :idempotent_replay, :target_provider, :message,
                          keyword_init: true) do
    def idempotent_replay?
      idempotent_replay == true
    end
  end

  # A provider that failed before an email was delivered.
  FailoverAttempt = Struct.new(:provider, :type, :error, :timestamp, keyword_init: true)

  # Attachment metadata, as returned in lists (size is the decoded size in bytes).
  AttachmentInfo = Struct.new(:filename, :mime_type, :size, keyword_init: true)

  # Attachment with its base64 content, as returned by {Emails#get}.
  AttachmentDetail = Struct.new(:filename, :mime_type, :size, :content, keyword_init: true) do
    # @return [String] the decoded bytes (binary String)
    def data
      content.unpack1('m')
    end
  end

  EMAIL_FIELDS = %i[id status to cc bcc subject html_body text_body from_email from_name provider_id provider_used
                    failover_history idempotency_key attempts error created_at updated_at attachments].freeze

  STATUS_PREDICATES = Module.new do
    EMAIL_STATUSES.each { |s| define_method(:"#{s}?") { status == s } }

    # True once the service will do nothing more with the email: sent, or failed after all delivery attempts.
    def final?
      status == 'sent' || (status == 'failed' && attempts >= MAX_DELIVERY_ATTEMPTS)
    end
  end

  # An email as stored by the service (list responses; attachments carry metadata only).
  Email = Struct.new(*EMAIL_FIELDS, keyword_init: true) { include STATUS_PREDICATES }

  # Full email from {Emails#get}; attachments include their base64 content.
  EmailDetail = Struct.new(*EMAIL_FIELDS, keyword_init: true) { include STATUS_PREDICATES }

  # One page of {Emails#list}. Enumerable over {#emails}.
  class ListResult
    include Enumerable

    attr_reader :emails, :total, :limit, :offset

    def initialize(emails:, total:, limit:, offset:)
      @emails = emails.freeze
      @total = total
      @limit = limit
      @offset = offset
      freeze
    end

    def has_more
      offset + emails.length < total
    end
    alias has_more? has_more

    def each(&block)
      return enum_for(:each) unless block

      emails.each(&block)
      self
    end

    def to_h
      { emails: emails, total: total, limit: limit, offset: offset, has_more: has_more }
    end
  end

  # Queue counters from {Client#status}.
  QueueStatus = Struct.new(:queued, :sending, :sent, :failed, keyword_init: true)

  # Result of {Client#health}.
  Health = Struct.new(:status, :runtime, :d1, :timestamp, keyword_init: true) do
    def ok?
      status == 'ok'
    end
  end
end
