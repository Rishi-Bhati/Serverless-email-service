# frozen_string_literal: true

module Unsent
  # The Unsent client. Thread-safe: create one and share it (for example in a constant or an initializer).
  #
  #   client = Unsent::Client.new(base_url: 'https://unsent.example.com', api_key: '...', api_secret: '...')
  #   client.send_email(to: 'user@example.com', subject: 'Hi', html: '<p>Hello</p>')
  #
  # With no options it reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET from the environment.
  class Client
    OPTION_KEYS = %i[base_url api_key api_secret default_from default_provider_id timeout max_retries transport
                     clock env].freeze

    # @return [Emails] send and inspect emails
    attr_reader :emails

    # @param base_url [String] your deployment URL; default ENV["UNSENT_BASE_URL"]
    # @param api_key [String] the API_KEY of your deployment; default ENV["UNSENT_API_KEY"]
    # @param api_secret [String, nil] the API_SECRET, used to HMAC-sign requests; default ENV["UNSENT_API_SECRET"].
    #   Required unless the server runs with SECURITY_MODE=api-key-only; safe to pass in every mode.
    # @param default_from [String, Hash, nil] sender used when a send has no +from+
    # @param default_provider_id [String, nil] provider used when a send has no +provider_id+
    # @param timeout [Numeric] per-attempt timeout in seconds (default 30)
    # @param max_retries [Integer] retries after the first attempt, 0..10 (default 3)
    # @param transport [#call, nil] custom HTTP transport (see {Transport}); default {Transport::NetHTTP}
    # @param clock [#now, #monotonic, #sleep, nil] custom clock (testing); default {SystemClock}
    # @param env [#[]] where to read the UNSENT_* variables from; default ENV
    # @raise [ConfigError]
    def initialize(*args, **kwargs)
      o = Options.parse(args, kwargs, OPTION_KEYS, 'Unsent::Client.new', error: ConfigError)
      env = o.fetch(:env, ENV)
      base_url = Config.clean(o[:base_url], 'base_url') || Config.env_value(env, 'UNSENT_BASE_URL')
      api_key = Config.clean(o[:api_key], 'api_key') || Config.env_value(env, 'UNSENT_API_KEY')
      api_secret = Config.clean(o[:api_secret], 'api_secret') || Config.env_value(env, 'UNSENT_API_SECRET')

      unless base_url
        raise ConfigError, 'Missing base_url. Pass base_url: or set UNSENT_BASE_URL (e.g. https://unsent.example.com).'
      end
      unless api_key
        raise ConfigError, 'Missing api_key. Pass api_key: or set UNSENT_API_KEY (the API_KEY of your deployment).'
      end

      transport = o[:transport] || Transport::NetHTTP.new
      raise ConfigError, 'transport must respond to #call' unless Util.responds?(transport, :call)

      clock = o[:clock] || SystemClock.new
      unless %i[now monotonic sleep].all? { |m| Util.responds?(clock, m) }
        raise ConfigError, 'clock must respond to #now, #monotonic and #sleep'
      end

      @http = HttpClient.new(
        base_url: Config.normalize_base_url(base_url),
        api_key: Config.credential(api_key, 'api_key'),
        api_secret: Config.credential(api_secret, 'api_secret'),
        timeout: Config.timeout(o[:timeout]),
        max_retries: Config.max_retries(o[:max_retries]),
        transport: transport,
        clock: clock
      )
      @emails = Emails.new(@http, clock, defaults(o))
      freeze
    end

    # Builds a client from an environment-like Hash, e.g. +Unsent::Client.from_env(ENV)+ or a secrets Hash.
    # Reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET; +overrides+ are the same options as {#initialize}.
    def self.from_env(env = ENV, **overrides)
      Config.env_value(env, 'UNSENT_BASE_URL') # validates +env+
      new(**overrides, env: env)
    end

    # Shortcut for {Emails#send_email}.
    def send_email(*args, **kwargs)
      emails.send_email(*args, **kwargs)
    end
    alias deliver send_email

    # Queue counters. Also a cheap way to verify that your credentials are accepted.
    # @return [QueueStatus]
    def status(*args, **kwargs)
      request = Options.request_options(Options.parse(args, kwargs, Emails::REQUEST_KEYS, 'status'))
      res = @http.execute(HttpClient::Call.new(method: 'GET', path: '/api/status', retry_safe: true, **request))
      d = Mapping.hash!(res.data, 'the response')
      QueueStatus.new(queued: Util.to_int(d['queued']), sending: Util.to_int(d['sending']),
                      sent: Util.to_int(d['sent']), failed: Util.to_int(d['failed'])).freeze
    end

    # Public liveness probe. Needs no credentials, so it does not verify them; use {#status} for that.
    # @return [Health]
    def health(*args, **kwargs)
      request = Options.request_options(Options.parse(args, kwargs, Emails::REQUEST_KEYS, 'health'))
      res = @http.execute(HttpClient::Call.new(method: 'GET', path: '/api/health', auth: false, retry_safe: true,
                                               **request))
      d = Mapping.hash!(res.data, 'the response')
      ts = d['timestamp']
      time = ts.is_a?(Numeric) && ts != 0 ? Util.to_time(ts) : Time.now.utc
      Health.new(status: Util.to_text(d['status']), runtime: Util.to_text(d['runtime']), d1: Util.to_text(d['d1']),
                 timestamp: time).freeze
    end

    # @return [String] the normalized base URL
    def base_url
      @http.base_url
    end

    def inspect
      "#<#{self.class.name} base_url=#{base_url.inspect} api_key=#{Secret::REDACTED} " \
        "api_secret=#{@http.has_api_secret? ? Secret::REDACTED : 'nil'}>"
    end
    alias to_s inspect

    def pretty_print(pp)
      pp.text(inspect)
    end

    def to_json(*)
      '{}'
    end

    def as_json(*)
      {}
    end

    def marshal_dump
      raise TypeError, 'Unsent::Client cannot be marshaled'
    end

    private

    def defaults(o)
      from = o[:default_from]
      from &&= begin
        Address.parse(from, 'default_from')
      rescue ValidationError => e
        raise ConfigError, e.message
      end
      provider = o[:default_provider_id]
      unless provider.nil?
        text = Util.utf8(provider)
        if text.nil? || text.include?("\0") || Util.blank?(text) || text.length > 255
          raise ConfigError, 'default_provider_id must be a non-empty string up to 255 characters'
        end

        provider = text.strip
      end
      { from: from, provider_id: provider }.freeze
    end
  end
end
