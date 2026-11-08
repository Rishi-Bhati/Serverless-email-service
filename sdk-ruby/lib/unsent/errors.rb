# frozen_string_literal: true

module Unsent
  # Base class of everything this gem raises on purpose, so `rescue Unsent::Error` handles every SDK failure.
  # Branch on {#code} (stable) rather than on the message (may change).
  class Error < StandardError
    # @return [String] stable machine-readable code, e.g. "invalid_api_key", "validation_error", "timeout"
    attr_reader :code
    # @return [String, nil] extra detail from the server (the API's `reason` field)
    attr_reader :reason
    # @return [String, nil] a short suggestion for fixing the problem, when the SDK knows one
    attr_reader :hint

    def initialize(message = nil, code: nil, reason: nil, hint: nil)
      super(message)
      @code = (code || default_code).to_s
      @reason = reason
      @hint = hint
    end

    def to_h
      { class: self.class.name, code: code, message: message, reason: reason, hint: hint }.compact
    end

    private

    def default_code
      'unsent_error'
    end
  end

  # The client was constructed with invalid options. Nothing was sent.
  class ConfigError < Error
    private

    def default_code
      'invalid_config'
    end
  end

  # A call was made with invalid arguments. Nothing was sent.
  class ValidationError < Error
    private

    def default_code
      'validation_error'
    end
  end

  # The request never produced an HTTP response (DNS, TLS, reset, offline, aborted...).
  class ConnectionError < Error
    private

    def default_code
      'connection_error'
    end
  end

  # A request exceeded its timeout (or {Emails#wait} exceeded its deadline).
  class TimeoutError < ConnectionError
    private

    def default_code
      'timeout'
    end
  end

  # The server answered with an error status.
  class APIError < Error
    # @return [Integer] HTTP status code
    attr_reader :status
    # @return [Object] parsed JSON error body (`{ "error", "code", "reason" }`), or the raw text when it was not JSON
    attr_reader :body
    # @return [Integer, nil] `id` of the conflicting email on idempotency conflicts (409)
    attr_reader :existing_email_id
    # @return [Float, nil] delay requested by the server through `Retry-After`, in seconds
    attr_reader :retry_after
    # @return [Float, nil] server time (Unix seconds) taken from the response `Date` header
    attr_reader :server_time

    def initialize(message = nil, status:, code:, reason: nil, hint: nil, body: nil, existing_email_id: nil,
                   retry_after: nil, server_time: nil)
      super(message, code: code, reason: reason, hint: hint)
      @status = status
      @body = body
      @existing_email_id = existing_email_id
      @retry_after = retry_after
      @server_time = server_time
    end

    def to_h
      super.merge(status: status, existing_email_id: existing_email_id, retry_after: retry_after).compact
    end
  end

  # 401: bad API key, bad signature, clock skew, replayed nonce...
  class AuthenticationError < APIError; end
  # 403: the endpoint needs an admin dashboard session, which API keys cannot provide.
  class PermissionError < APIError; end
  # 404: unknown email or route.
  class NotFoundError < APIError; end
  # 409: the idempotency key was already used for a different email.
  class ConflictError < APIError; end
  # 400 / 413: the server rejected the request contents.
  class RequestError < APIError; end
  # 429.
  class RateLimitError < APIError; end
  # 5xx: server-side failure.
  class ServerError < APIError; end

  # Builds the right error class from an HTTP error response.
  module ErrorFactory
    SIGNED_HINT = 'The server requires signed requests. Pass api_secret (UNSENT_API_SECRET) to the client.'
    API_KEY_HINT = 'Check that api_key matches the API_KEY secret of your Unsent deployment.'

    HINTS = {
      'invalid_api_key' => API_KEY_HINT,
      'unauthorized' => API_KEY_HINT,
      'invalid_signature' => 'Check that api_secret matches the API_SECRET secret of your Unsent deployment ' \
                             '(no extra whitespace).',
      'missing_signature' => SIGNED_HINT,
      'nonce_reused' => 'A nonce was replayed. This should not happen with the SDK; check for proxies that ' \
                        'duplicate requests.',
      'server_misconfigured' => 'The Unsent server is missing configuration (API_KEY, API_SECRET, SECURITY_MODE or ' \
                                'IDEMPOTENCY_TTL_HOURS). See the server logs.',
      'unauthorized_sender' => 'The "from" address or provider_id is not an active provider. Configure it in the ' \
                               'dashboard, or omit "from" to use the default provider.',
      'forbidden' => 'This endpoint needs an admin dashboard session; API keys cannot call it.'
    }.freeze

    MAX_MESSAGE = 200
    CONTROL = /[[:cntrl:]]+/

    module_function

    # @param redactor [#call] maps a String to a String with credentials removed
    def from_response(status, body, has_secret:, redactor:, retry_after: nil, server_time: nil, status_text: nil)
      body = deep_redact(body, redactor, 0)
      obj = body.is_a?(Hash) ? body : nil
      code = string_field(obj, 'code')
      code = code ? code[0, 100] : (status >= 500 ? 'internal_error' : "http_#{status}")
      base = string_field(obj, 'error')
      base ||= body.strip[0, MAX_MESSAGE] if body.is_a?(String) && !body.strip.empty?
      base ||= status_text.to_s.strip unless status_text.to_s.strip.empty?
      base ||= "HTTP #{status}"
      base = clean(base)
      reason = string_field(obj, 'reason')
      reason = clean(reason) if reason

      hint = HINTS[code]
      if code == 'timestamp_skew'
        hint = has_secret ? 'Your system clock differs from the server by more than 3 minutes. Sync it (NTP).' : SIGNED_HINT
      elsif code == 'invalid_nonce' && !has_secret
        hint = SIGNED_HINT
      end

      message = reason && !base.include?(reason) ? "#{base}: #{reason}" : base
      message += " (#{hint})" if hint

      id = obj && obj['id']
      existing = id.is_a?(Integer) ? id : nil
      opts = { status: status, code: code, reason: reason, hint: hint, body: body, existing_email_id: existing,
               retry_after: retry_after, server_time: server_time }
      klass_for(status).new(message, **opts)
    end

    def klass_for(status)
      case status
      when 401 then AuthenticationError
      when 403 then PermissionError
      when 404 then NotFoundError
      when 409 then ConflictError
      when 429 then RateLimitError
      when 400, 413 then RequestError
      else status >= 500 ? ServerError : APIError
      end
    end

    def string_field(obj, key)
      v = obj && obj[key]
      v.is_a?(String) && !v.empty? ? v : nil
    end

    def clean(text)
      text.dup.force_encoding(Encoding::UTF_8).scrub('?').gsub(CONTROL, ' ').strip[0, 1000]
    end

    def deep_redact(value, redactor, depth)
      return value if depth > 120

      case value
      when String then redactor.call(value)
      when Array then value.map { |v| deep_redact(v, redactor, depth + 1) }
      when Hash then value.each_with_object({}) { |(k, v), h| h[redactor.call(k.to_s)] = deep_redact(v, redactor, depth + 1) }
      else value
      end
    end
  end
end
