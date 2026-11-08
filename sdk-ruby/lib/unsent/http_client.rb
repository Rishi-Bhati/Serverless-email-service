# frozen_string_literal: true

require 'json'
require 'openssl'
require 'securerandom'
require 'time'
require 'timeout'
require 'uri'

module Unsent
  # @api private
  # Signing, retries, timeouts, clock-skew correction and error mapping. One instance is shared by every
  # thread using a {Client}; the only mutable state (the learned clock offset) is guarded by a mutex.
  class HttpClient
    MAX_BACKOFF = 8.0
    MAX_RETRY_AFTER = 60.0
    BASE_BACKOFF = 0.5
    # Skews smaller than this are not worth correcting (the server tolerates 180 s).
    MIN_CLOCK_CORRECTION = 30.0
    MAX_RESPONSE_BYTES = 32 * 1024 * 1024
    USER_AGENT = "unsent-sdk-ruby/#{VERSION}"

    # One logical API call (possibly several HTTP attempts).
    Call = Struct.new(:method, :path, :query, :body, :sign, :auth, :retry_safe, :cancel, :timeout, :max_retries,
                      keyword_init: true)
    Result = Struct.new(:status, :data, :headers, keyword_init: true)

    attr_reader :base_url

    def initialize(base_url:, api_key:, api_secret:, timeout:, max_retries:, transport:, clock:)
      @base_url = base_url
      @api_key = Secret.new(api_key)
      @api_secret = api_secret && Secret.new(api_secret)
      @timeout = timeout
      @max_retries = max_retries
      @transport = transport
      @clock = clock
      @clock_offset = 0.0
      @offset_lock = Mutex.new
      @host = URI.parse(base_url).host
    end

    def has_api_secret?
      !@api_secret.nil?
    end

    def inspect
      "#<#{self.class.name} base_url=#{@base_url.inspect}>"
    end
    alias to_s inspect

    def marshal_dump
      raise TypeError, 'Unsent::Client cannot be marshaled'
    end

    # Runs +call+, retrying where it is safe. Raises {Error} subclasses only.
    def execute(call)
      max_retries = call.max_retries || @max_retries
      timeout = call.timeout || @timeout
      attempt = 0
      clock_corrected = false
      loop do
        raise aborted('The request was aborted') if call.cancel&.cancelled?

        begin
          return attempt_once(call, timeout)
        rescue Error => e
          raise aborted('The request was aborted') if call.cancel&.cancelled?

          # A skewed local clock fails signature checks before the nonce is consumed, so one corrected
          # retry is free and always safe.
          if !clock_corrected && e.code == 'timestamp_skew' && has_api_secret?
            clock_corrected = true
            next if sync_clock(e, call.cancel)
          end

          delay = retry_delay(e, attempt, max_retries, call.retry_safe)
          raise if delay.nil?

          attempt += 1
          @clock.sleep(delay, call.cancel)
        end
      end
    end

    private

    def retry_delay(error, attempt, max_retries, retry_safe)
      return nil unless retry_safe && attempt < max_retries

      if error.is_a?(ConnectionError)
        error.code == 'aborted' ? nil : backoff(attempt)
      elsif error.is_a?(APIError) && retryable_status?(error)
        [backoff(attempt), error.retry_after || 0].max
      end
    end

    def backoff(attempt)
      exp = [MAX_BACKOFF, BASE_BACKOFF * (2**attempt)].min
      (exp / 2) + (rand * (exp / 2))
    end

    def retryable_status?(error)
      return false if error.code == 'server_misconfigured'

      s = error.status
      [408, 425, 429].include?(s) || (s >= 500 && s != 501 && s != 505)
    end

    def aborted(message)
      ConnectionError.new(message, code: 'aborted')
    end

    def clock_offset
      @offset_lock.synchronize { @clock_offset }
    end

    def clock_offset=(value)
      @offset_lock.synchronize { @clock_offset = value }
    end

    # Learns how far the local clock is from the server's, from the error's Date header or, failing that,
    # the server timestamp in the public health probe. True when a retry is worthwhile.
    def sync_clock(error, cancel)
      server = error.server_time
      local = @clock.now
      if server.nil?
        begin
          before = @clock.now
          probe = Call.new(method: 'GET', path: '/api/health', auth: false, retry_safe: true, cancel: cancel)
          res = attempt_once(probe, [@timeout, 5.0].min)
          after = @clock.now
          ts = res.data.is_a?(Hash) ? res.data['timestamp'] : nil
          return false unless ts.is_a?(Numeric) && ts.respond_to?(:finite?) && ts.finite?

          server = ts / 1000.0
          local = (before + after) / 2.0
        rescue StandardError
          raise aborted('The request was aborted') if cancel&.cancelled?

          return false
        end
      end
      offset = server - local
      if offset.abs < MIN_CLOCK_CORRECTION
        # The local clock is fine now. If we were compensating for an earlier skew (the host clock was since
        # fixed), drop the stale offset and retry; otherwise skew is not the problem.
        return false if clock_offset.zero?

        self.clock_offset = 0.0
        return true
      end
      self.clock_offset = offset
      true
    end

    def build_url(call)
      url = @base_url + call.path
      pairs = (call.query || {}).reject { |_, v| v.nil? || v == '' }.map { |k, v| [k.to_s, v.to_s] }
      pairs.empty? ? url : "#{url}?#{URI.encode_www_form(pairs)}"
    end

    def build_headers(call)
      headers = { 'Accept' => 'application/json' }
      headers['X-API-Key'] = @api_key.reveal if call.auth != false
      headers['Content-Type'] = 'application/json' if call.body
      headers['User-Agent'] = USER_AGENT
      if call.sign && @api_secret
        # Fresh timestamp + nonce on every attempt: the server rejects reused nonces.
        timestamp = (@clock.now + clock_offset).floor.to_s
        nonce = SecureRandom.hex(16)
        body_hash = OpenSSL::Digest::SHA256.hexdigest(call.body.to_s)
        signature = OpenSSL::HMAC.hexdigest('SHA256', @api_secret.reveal, "#{timestamp}\n#{nonce}\n#{body_hash}")
        headers['X-Timestamp'] = timestamp
        headers['X-Nonce'] = nonce
        headers['X-Signature'] = "sha256=#{signature}"
      end
      headers
    end

    def attempt_once(call, timeout)
      url = build_url(call)
      path = URI.parse(url).path
      request = Transport::Request.new(method: call.method, url: url, headers: build_headers(call), body: call.body,
                                       timeout: timeout.to_f, max_response_bytes: MAX_RESPONSE_BYTES)
      raw = perform(request, call.cancel, timeout, path)
      interpret(raw, path)
    end

    # Runs the transport in its own thread so that the per-attempt deadline and cancellation hold even when the
    # transport blocks (a slow-drip server, a hung socket, a custom transport that never returns).
    def perform(request, cancel, timeout, path)
      latch = Latch.new
      unregister = cancel&.on_cancel { latch.set([:cancel]) }
      worker = Thread.new do
        outcome = begin
          [:ok, @transport.call(request)]
        rescue Exception => e # rubocop:disable Lint/RescueException -- forwarded to the calling thread
          [:error, e]
        end
        latch.set(outcome)
      end
      done, outcome = latch.wait(timeout)
      raise TimeoutError, "Request to #{path} timed out after #{format_seconds(timeout)}" unless done

      case outcome[0]
      when :ok then outcome[1]
      when :cancel then raise aborted('The request was aborted')
      else
        error = translate(outcome[1])
        error.equal?(outcome[1]) ? raise(error) : raise(error, cause: outcome[1])
      end
    ensure
      worker&.kill
      unregister&.call
    end

    def format_seconds(seconds)
      s = seconds.to_f
      s == s.to_i ? "#{s.to_i} s" : "#{s.round(3)} s"
    end

    def translate(error)
      case error
      when Error then error
      when Transport::BodyTooLarge
        Error.new('The response is larger than 32 MiB and was discarded', code: 'response_too_large')
      when Timeout::Error
        TimeoutError.new("Request to #{@host} timed out")
      when StandardError
        ConnectionError.new("Could not reach #{@host}: #{redact(error.message.to_s)[0, 300]}")
      else
        error
      end
    end

    def redact(text)
      out = text.dup.force_encoding(Encoding::UTF_8).scrub('?')
      [@api_key, @api_secret].each do |secret|
        next unless secret && secret.reveal.length >= Secret::MIN_SCRUB_LENGTH

        out = out.gsub(secret.reveal, Secret::REDACTED)
      end
      out
    end

    def interpret(raw, path)
      status, headers, body = begin
        coerce(raw)
      rescue Error
        raise
      rescue StandardError
        raise Error.new('The transport returned an unusable response', code: 'invalid_response')
      end
      declared = headers['content-length']
      if declared&.match?(/\A\d{1,20}\z/) && declared.to_i > MAX_RESPONSE_BYTES
        raise Error.new('The response is larger than 32 MiB and was discarded', code: 'response_too_large')
      end
      if body.bytesize > MAX_RESPONSE_BYTES
        raise Error.new('The response is larger than 32 MiB and was discarded', code: 'response_too_large')
      end

      if status >= 300 && status < 400
        raise redirect_error(path, headers['location'])
      end

      text = body.dup.force_encoding(Encoding::UTF_8)
      text = text.scrub('?') unless text.valid_encoding?
      data, json = parse_json(text)

      unless status >= 200 && status < 300
        raise ErrorFactory.from_response(
          status, json ? data : text, has_secret: has_api_secret?, redactor: method(:redact),
          retry_after: parse_retry_after(headers['retry-after']), server_time: parse_server_time(headers['date']),
          status_text: nil
        )
      end
      unless json
        raise Error.new("Unexpected non-JSON response from #{path} (HTTP #{status}). " \
                        'Is base_url pointing at your Unsent deployment?', code: 'invalid_response')
      end

      Result.new(status: status, data: data, headers: headers)
    end

    def redirect_error(path, location)
      loc = location.to_s.dup.force_encoding(Encoding::UTF_8).scrub('?').gsub(/[[:cntrl:]]/, '')[0, 200]
      Error.new("#{path} was redirected#{loc.empty? ? '' : " to #{loc}"}. The SDK does not follow redirects because " \
                'that would send your API key to another host. Set base_url to the final URL.',
                code: 'unexpected_redirect')
    end

    def parse_json(text)
      return [text, false] if text.strip.empty?

      [JSON.parse(text), true]
    rescue JSON::ParserError, EncodingError, ArgumentError, TypeError
      [text, false]
    end

    # @return [Array(Integer, Hash{String=>String}, String)]
    def coerce(raw)
      raw = { status: raw[:status], headers: raw[:headers], body: raw[:body] } if raw.is_a?(Hash)
      unless raw.respond_to?(:status) && raw.respond_to?(:headers) && raw.respond_to?(:body)
        raise Error.new('The transport returned an unusable response', code: 'invalid_response') unless raw.is_a?(Hash)
      end
      status = raw.respond_to?(:status) ? raw.status : raw[:status]
      headers = raw.respond_to?(:headers) ? raw.headers : raw[:headers]
      body = raw.respond_to?(:body) ? raw.body : raw[:body]
      body = '' if body.nil?
      unless status.is_a?(Integer) && status >= 200 && status <= 599 && body.is_a?(String)
        raise Error.new("The transport returned an unusable response (status #{Util.show(status, 20)})",
                        code: 'invalid_response')
      end

      [status, normalize_headers(headers), body]
    end

    def normalize_headers(headers)
      out = {}
      return out unless headers.respond_to?(:each_pair)

      headers.each_pair do |k, v|
        next unless k.is_a?(String) || k.is_a?(Symbol)

        value = v.is_a?(Array) ? v.join(', ') : v
        out[text(k).downcase] = text(value)[0, 8192]
      end
      out
    end

    def text(value)
      value.to_s.dup.force_encoding(Encoding::UTF_8).scrub('?')
    end

    # Retry-After as seconds (capped at 60), from a number of seconds or an HTTP date. Invalid values are ignored.
    def parse_retry_after(value)
      return nil unless value.is_a?(String)

      v = value.strip
      return nil if v.empty? || v.length > 100

      if v.match?(/\A\d+(?:\.\d+)?\z/)
        return [v.to_f, MAX_RETRY_AFTER].min
      end

      time = parse_http_date(v)
      time && [[time.to_f - @clock.now, 0.0].max, MAX_RETRY_AFTER].min
    end

    def parse_server_time(value)
      return nil unless value.is_a?(String) && value.length <= 100

      parse_http_date(value.strip)&.to_f
    end

    def parse_http_date(value)
      Time.httpdate(value)
    rescue ArgumentError
      begin
        Time.rfc2822(value)
      rescue ArgumentError
        nil
      end
    end
  end
end
