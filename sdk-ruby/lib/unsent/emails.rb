# frozen_string_literal: true

require 'date'
require 'json'
require 'securerandom'

module Unsent
  # `client.emails`: send and inspect emails. Obtain it from {Client#emails}; thread-safe.
  class Emails
    IDEMPOTENCY_KEY = /\A[\x21-\x7e]{1,255}\z/
    MAX_SUBJECT = 1000
    MAX_BODY_BYTES = Attachment::MAX_BODY_BYTES
    DAY = /\A\d{4}-\d{2}-\d{2}/
    REQUEST_KEYS = %i[timeout max_retries cancel].freeze
    SEND_KEYS = (%i[from to cc bcc subject html text attachments provider_id idempotency_key] + REQUEST_KEYS).freeze
    LIST_KEYS = (%i[limit offset status search from to sort] + REQUEST_KEYS).freeze
    EACH_KEYS = (LIST_KEYS - %i[offset]).freeze
    WAIT_KEYS = %i[timeout interval cancel].freeze
    HTML_ESCAPES = { '&' => '&amp;', '<' => '&lt;', '>' => '&gt;', '"' => '&quot;', "'" => '&#39;' }.freeze

    # @api private
    def initialize(http, clock, defaults)
      @http = http
      @clock = clock
      @defaults = defaults
      freeze
    end

    # Queues an email for delivery. Returns as soon as the service has accepted it (HTTP 202); delivery happens
    # in the background. Use {#wait} to block until it is actually sent.
    #
    # Retries on network errors, timeouts, 429 and 5xx are automatic and cannot cause duplicates: every send
    # carries an idempotency key (yours, or a generated UUID).
    #
    # @param from [String, Hash] "Name <a@b.co>", "a@b.co" or { email:, name: }; falls back to the client's default_from
    # @param to [String, Array<String>] up to 100 recipients
    # @param cc [String, Array<String>, nil]
    # @param bcc [String, Array<String>, nil]
    # @param subject [String] required, up to 1000 characters
    # @param html [String, nil] provide html, text, or both
    # @param text [String, nil] plain-text body; when html is omitted an HTML body is derived from it
    # @param attachments [Array<Hash>, nil] see {Attachment}; up to 20
    # @param provider_id [String, nil] force a specific provider; falls back to the client's default_provider_id
    # @param idempotency_key [String, false, nil] your own key, +false+ to disable (then the send is never retried)
    # @param timeout [Numeric, nil] per-attempt timeout in seconds, overriding the client default
    # @param max_retries [Integer, nil] 0..10, overriding the client default
    # @param cancel [CancelToken, nil]
    # @return [SendResult]
    # @raise [ValidationError] nothing was sent
    # @raise [APIError, ConnectionError, TimeoutError]
    def send_email(*args, **kwargs)
      o = Options.parse(args, kwargs, SEND_KEYS, 'send_email')
      request = Options.request_options(o)

      to = Address.recipients(o[:to], 'to', true)
      cc = Address.recipients(o[:cc], 'cc', false)
      bcc = Address.recipients(o[:bcc], 'bcc', false)
      subject = validate_subject(o[:subject])
      html, text = bodies(o[:html], o[:text])
      attachments = wire_attachments(o[:attachments])

      from_in = o[:from].nil? ? @defaults[:from] : o[:from]
      from = from_in.nil? ? nil : Address.parse(from_in, 'from')
      provider_id = o[:provider_id].nil? ? @defaults[:provider_id] : o[:provider_id]
      provider_id = validate_provider_id(provider_id)
      key = idempotency_key(o[:idempotency_key])

      payload = { to: to }
      payload[:cc] = cc if cc
      payload[:bcc] = bcc if bcc
      payload[:subject] = subject
      payload[:html] = html
      payload[:text] = text if text
      payload[:attachments] = attachments if attachments
      payload[:from] = from if from
      payload[:provider_id] = provider_id if provider_id
      payload[:idempotency_key] = key if key
      body = JSON.generate(payload)
      if body.bytesize > MAX_BODY_BYTES
        raise ValidationError.new("The request body is #{body.bytesize} bytes (maximum #{MAX_BODY_BYTES}); " \
                                  'reduce the attachments or body size', code: 'payload_too_large')
      end

      res = @http.execute(HttpClient::Call.new(
                            method: 'POST', path: '/api/send', body: body, sign: true, auth: true,
                            # Without a key a retry could duplicate the email, so only keyed sends are retried.
                            retry_safe: !key.nil?, **request
                          ))
      send_result(res, key)
    end
    alias deliver send_email

    # Fetches one email, including attachment contents.
    # @raise [NotFoundError] if it does not exist
    # @return [EmailDetail]
    def get(*args, **kwargs)
      id, rest = args.first, args.drop(1)
      request = Options.request_options(Options.parse(rest, kwargs, REQUEST_KEYS, 'get'))
      fetch(id, request)
    end

    # Lists emails, most recently updated first by default. Attachment contents are not included.
    #
    # @param limit [Integer, nil] 1..200
    # @param offset [Integer, nil]
    # @param status [String, Symbol, nil] queued | sending | sent | failed
    # @param search [String, nil] matches subject, recipients, sender, provider, body and error text
    # @param from [Date, Time, String, nil] created on/after this day (UTC)
    # @param to [Date, Time, String, nil] created on/before this day (UTC)
    # @param sort [String, Symbol, nil] one of {SORT_ORDERS}
    # @return [ListResult]
    def list(*args, **kwargs)
      o = Options.parse(args, kwargs, LIST_KEYS, 'list')
      query = list_query(o)
      request = Options.request_options(o)
      page(query, request)
    end

    # Iterates over every matching email, fetching pages as needed. Oldest first by default, so emails sent while
    # iterating do not shift pages. Without a block it returns a lazy Enumerator.
    #
    #   client.emails.each(status: :failed).first(10)
    #   client.emails.each(search: 'invoice') { |email| puts email.subject }
    def each(*args, **kwargs, &block)
      o = Options.parse(args, kwargs, EACH_KEYS, 'each')
      query = list_query(o)
      query[:sort] ||= 'created_at_asc'
      request = Options.request_options(o)
      enum = Enumerator.new do |yielder|
        offset = 0
        loop do
          result = page(query.merge(offset: offset), request)
          result.each { |email| yielder << email }
          break if !result.has_more || result.emails.empty?

          offset += result.emails.length
        end
      end
      block ? enum.each(&block) : enum
    end
    alias iterate each

    # Polls until the email is delivered ("sent") or has permanently failed ("failed" after all attempts), then
    # returns it. Check +email.status+; a permanent failure does not raise.
    #
    # @param timeout [Numeric] give up after this many seconds with {TimeoutError} (default 60)
    # @param interval [Numeric] first poll interval in seconds; grows by 1.5x up to 5 s (default 1)
    # @param cancel [CancelToken, nil]
    # @return [EmailDetail]
    def wait(*args, **kwargs)
      id, rest = args.first, args.drop(1)
      o = Options.parse(rest, kwargs, WAIT_KEYS, 'wait')
      timeout = positive_option(o, :timeout, 60.0)
      interval = [0.1, positive_option(o, :interval, 1.0)].max
      cancel = Options.request_options(o)[:cancel]
      validate_id(id)

      deadline = @clock.monotonic + timeout
      loop do
        email = fetch(id, timeout: nil, max_retries: nil, cancel: cancel)
        return email if email.final?

        remaining = deadline - @clock.monotonic
        if remaining <= 0
          raise TimeoutError, "Email #{id} was still \"#{email.status}\" after #{format_seconds(timeout)}"
        end

        @clock.sleep([interval, remaining].min, cancel)
        raise ConnectionError.new('The wait was aborted', code: 'aborted') if cancel&.cancelled?

        interval = [5.0, interval * 1.5].min
      end
    end

    private

    def positive_option(opts, key, default)
      value = opts[key]
      return default.to_f if value.nil?
      raise ValidationError, %("#{key}" must be a positive number of seconds) unless Util.positive_finite?(value)

      value.to_f
    end

    def format_seconds(seconds)
      seconds == seconds.to_i ? "#{seconds.to_i} s" : "#{seconds.round(3)} s"
    end

    def validate_id(id)
      return if id.is_a?(Integer) && id.between?(1, Util::MAX_SAFE_INTEGER)

      raise ValidationError, '"id" must be a positive integer'
    end

    def fetch(id, request)
      validate_id(id)
      res = @http.execute(HttpClient::Call.new(method: 'GET', path: "/api/emails/#{id}", retry_safe: true, **request))
      Mapping.email_detail(Mapping.hash!(Mapping.hash!(res.data, 'the response')['email'], '"email"'))
    end

    def page(query, request)
      res = @http.execute(HttpClient::Call.new(method: 'GET', path: '/api/emails', query: query, retry_safe: true,
                                               **request))
      data = Mapping.hash!(res.data, 'the response')
      rows = data['emails'].nil? ? [] : data['emails']
      Mapping.invalid!('"emails" is not a list') unless rows.is_a?(Array)
      emails = rows.map { |row| Mapping.email(Mapping.hash!(row, 'an email')) }
      limit = Util.to_int(data['limit'])
      ListResult.new(emails: emails, total: Util.to_int(data['total']),
                     limit: limit.zero? ? emails.length : limit, offset: Util.to_int(data['offset']))
    end

    def list_query(o)
      limit = o[:limit]
      unless limit.nil? || (limit.is_a?(Integer) && limit.between?(1, 200))
        raise ValidationError, '"limit" must be an integer from 1 to 200'
      end
      offset = o[:offset]
      unless offset.nil? || (offset.is_a?(Integer) && offset.between?(0, Util::MAX_SAFE_INTEGER))
        raise ValidationError, '"offset" must be a non-negative integer'
      end
      search = o[:search]
      unless search.nil?
        search = Util.utf8(search)
        raise ValidationError, '"search" must be a string' if search.nil?
        raise ValidationError, '"search" is too long (maximum 500 characters)' if search.length > 500
      end
      { limit: limit, offset: offset, status: enum_option(o[:status], EMAIL_STATUSES, 'status'), q: search,
        from: day_param(o[:from], 'from'), to: day_param(o[:to], 'to'), sort: enum_option(o[:sort], SORT_ORDERS, 'sort') }
    end

    def enum_option(value, allowed, name)
      return nil if value.nil?

      text = value.is_a?(Symbol) ? value.to_s : value
      return text if text.is_a?(String) && allowed.include?(text)

      raise ValidationError, %("#{name}" must be one of: #{allowed.join(', ')})
    end

    def day_param(value, field)
      case value
      when nil then nil
      when String
        text = Util.utf8(value)
        raise ValidationError, %("#{field}" must be a Date or YYYY-MM-DD) unless text&.match?(DAY)

        text[0, 10]
      when Time then value.getutc.strftime('%Y-%m-%d')
      when DateTime then value.new_offset(0).strftime('%Y-%m-%d')
      when Date then value.strftime('%Y-%m-%d')
      else raise ValidationError, %("#{field}" must be a Date or YYYY-MM-DD)
      end
    end

    def validate_subject(value)
      subject = Util.utf8(value)
      raise ValidationError, '"subject" is required' if subject.nil? || Util.blank?(subject)
      if subject.length > MAX_SUBJECT
        raise ValidationError, %("subject" is #{subject.length} characters (maximum #{MAX_SUBJECT}))
      end

      subject
    end

    # @return [Array(String, String|nil)] html (derived from text when missing) and text
    def bodies(html_in, text_in)
      html = text = nil
      unless html_in.nil?
        html = Util.utf8(html_in)
        raise ValidationError, '"html" must be a string' if html.nil?
      end
      unless text_in.nil?
        text = Util.utf8(text_in)
        raise ValidationError, '"text" must be a string' if text.nil?
      end
      has_html = !html.nil? && !Util.blank?(html)
      has_text = !text.nil? && !Util.blank?(text)
      raise ValidationError, 'Provide "html", "text", or both' unless has_html || has_text

      # The API requires an HTML body; derive one from the text so text-only sends just work.
      html = %(<div style="white-space:pre-wrap">#{text.gsub(/[&<>"']/, HTML_ESCAPES)}</div>) unless has_html
      [html, has_text ? text : nil]
    end

    def wire_attachments(list)
      return nil if list.nil?
      raise ValidationError, '"attachments" must be an array' unless list.is_a?(Array)
      if list.length > Attachment::MAX_ATTACHMENTS
        raise ValidationError,
              "Too many attachments (#{list.length}, maximum #{Attachment::MAX_ATTACHMENTS})"
      end
      return nil if list.empty?

      list.each_with_index.map { |att, i| Attachment.to_wire(att, i) }
    end

    def validate_provider_id(value)
      return nil if value.nil?

      text = Util.utf8(value)
      if text.nil? || text.include?("\0") || Util.blank?(text) || text.length > 255
        raise ValidationError, '"provider_id" must be a non-empty string up to 255 characters'
      end

      text.strip
    end

    def idempotency_key(value)
      return nil if value == false
      return SecureRandom.uuid if value.nil?

      text = Util.utf8(value)
      text = text.strip unless text.nil? || text.include?("\0") # String#strip also eats trailing NULs
      unless text&.match?(IDEMPOTENCY_KEY)
        raise ValidationError.new(
          '"idempotency_key" must be 1-255 printable ASCII characters without spaces ' \
          '(e.g. a UUID or "order-123:receipt"), or false to disable idempotency',
          code: 'invalid_idempotency_key'
        )
      end

      text
    end

    def send_result(res, key)
      data = Mapping.hash!(res.data, 'the response')
      id = data['id']
      id = Util.to_int(id, nil) unless id.is_a?(Integer)
      Mapping.invalid!('the email id is missing') if id.nil? || id < 1

      status = data['status']
      SendResult.new(
        id: id,
        status: EMAIL_STATUSES.include?(status) ? status : 'queued',
        idempotency_key: data['idempotency_key'].is_a?(String) ? data['idempotency_key'] : key,
        idempotent_replay: data['idempotent_replay'] == true || res.headers['idempotent-replayed'] == 'true',
        target_provider: Util.to_text(data['targetProvider']),
        message: Util.to_text(data['message'])
      ).freeze
    end
  end
end
