# frozen_string_literal: true

module Unsent
  # ActionMailer / Mail delivery method that sends through an Unsent deployment.
  #
  #   # config/environments/production.rb
  #   config.action_mailer.delivery_method = :unsent
  #   config.action_mailer.unsent_settings = {
  #     base_url: ENV.fetch('UNSENT_BASE_URL'),
  #     api_key: ENV.fetch('UNSENT_API_KEY'),
  #     api_secret: ENV.fetch('UNSENT_API_SECRET')
  #   }
  #
  # With an empty settings Hash the UNSENT_* environment variables are used. Settings accept every
  # {Client#initialize} option, plus +client:+ to supply a ready-made {Client}.
  #
  # What is mapped: from (with display name), to / cc / bcc, subject, the html and plain-text parts (single part or
  # multipart/alternative, also inside multipart/mixed) and attachments (inline ones too, as regular attachments).
  # Per-message headers: +provider_id+ (or X-Provider-Id / X-Unsent-Provider-Id) selects a provider;
  # +X-Idempotency-Key+ (or Idempotency-Key / X-Unsent-Idempotency-Key) sets the idempotency key. Everything else
  # (reply-to, custom headers, display names of recipients) is not supported by the Unsent API and is dropped.
  #
  # Also usable with the plain +mail+ gem: +Mail.defaults { delivery_method Unsent::DeliveryMethod, api_key: ... }+.
  class DeliveryMethod
    PROVIDER_HEADERS = %w[provider_id X-Provider-Id X-Unsent-Provider-Id].freeze
    IDEMPOTENCY_HEADERS = %w[X-Idempotency-Key Idempotency-Key X-Unsent-Idempotency-Key].freeze
    SETTING_KEYS = (Client::OPTION_KEYS + %i[client]).freeze
    CACHE_LIMIT = 16

    @cache = {}
    @cache_lock = Mutex.new

    class << self
      # Registers +:unsent+ with ActionMailer once ActionMailer::Base has loaded (immediately if it already has).
      # Called automatically when ActionMailer is present; safe to call more than once.
      def register!
        return false unless defined?(::ActiveSupport) && ::ActiveSupport.respond_to?(:on_load)

        ::ActiveSupport.on_load(:action_mailer) { add_delivery_method :unsent, ::Unsent::DeliveryMethod }
        true
      end

      # @api private
      # Clients are cached per settings so the learned clock offset and the config validation survive between mails.
      def client_for(settings)
        @cache_lock.synchronize do
          @cache[settings] ||= begin
            @cache.shift if @cache.size >= CACHE_LIMIT
            build_client(settings)
          end
        end
      end

      def clear_cache!
        @cache_lock.synchronize { @cache.clear }
      end

      private

      def build_client(settings)
        return settings[:client] if settings[:client]

        Client.new(**settings)
      end
    end

    # @return [Hash] the settings Hash given by ActionMailer (+unsent_settings+)
    attr_accessor :settings

    def initialize(settings = nil)
      @settings = normalize(settings)
    end

    # Delivers +mail+ (a Mail::Message). Returns the {SendResult}.
    # @raise [Error] on failure; ActionMailer raises it when +raise_delivery_errors+ is true
    def deliver!(mail)
      client.send_email(**build_options(mail))
    end

    # Translates a Mail::Message into {Emails#send_email} options (exposed for tests and tooling).
    def build_options(mail)
      html, text = bodies(mail)
      opts = { to: list(mail.to), subject: mail.subject.to_s, html: html, text: text,
               attachments: attachments(mail), from: sender(mail) }
      cc = list(mail.cc)
      bcc = list(mail.bcc)
      opts[:cc] = cc if cc
      opts[:bcc] = bcc if bcc
      provider = header_value(mail, PROVIDER_HEADERS)
      opts[:provider_id] = provider if provider
      key = header_value(mail, IDEMPOTENCY_HEADERS)
      opts[:idempotency_key] = key if key
      opts.compact
    end

    private

    def normalize(settings)
      return {} if settings.nil?
      raise ConfigError, 'Unsent delivery settings must be a Hash' unless Util.responds?(settings, :to_h)

      h = settings.to_h.each_with_object({}) do |(k, v), acc|
        key = k.respond_to?(:to_sym) ? k.to_sym : k
        raise ConfigError, "Unknown Unsent delivery setting: #{Util.show(k, 40)}" unless SETTING_KEYS.include?(key)

        acc[key] = v
      end
      h.freeze
    end

    def client
      @client ||= self.class.client_for(settings)
    end

    def list(addresses)
      list = Array(addresses).map(&:to_s)
      list.empty? ? nil : list
    end

    def sender(mail)
      field = mail[:from] if mail.respond_to?(:[])
      addr = field.respond_to?(:addrs) ? field.addrs.first : nil
      return nil unless addr

      email = addr.address.to_s
      name = addr.display_name.to_s.strip
      name.empty? ? { email: email } : { email: email, name: name }
    end

    def header_value(mail, names)
      names.each do |name|
        field = mail[name]
        field = field.first if field.is_a?(Array)
        value = field&.value.to_s.strip
        return value unless value.nil? || value.empty?
      end
      nil
    end

    def bodies(mail)
      if mail.multipart?
        [part_text(mail.html_part), part_text(mail.text_part)]
      elsif mail.mime_type.to_s.casecmp?('text/html')
        [part_text(mail), nil]
      elsif mail.mime_type.nil? || mail.mime_type.to_s.casecmp?('text/plain')
        [nil, part_text(mail)]
      else
        [nil, nil]
      end
    end

    def part_text(part)
      return nil unless part

      body = part.respond_to?(:decoded) ? part.decoded : part.body.decoded
      body.to_s
    end

    def attachments(mail)
      list = mail.attachments.each_with_index.map do |att, i|
        { filename: att.filename.to_s.empty? ? "attachment-#{i + 1}" : att.filename,
          content: att.body.decoded.to_s.b, content_type: att.mime_type }
      end
      list.empty? ? nil : list
    end
  end
end

Unsent::DeliveryMethod.register!
