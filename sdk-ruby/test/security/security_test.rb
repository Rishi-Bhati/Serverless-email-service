# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/tiny_server'
require 'pp'
require 'yaml'

# SPEC.md §7.3 — security properties that must hold no matter what the caller, the network or the server does:
#
# * credentials never leak through inspect / to_s / pp / JSON / error messages / error fields;
# * credentials that could smuggle a header (CR, LF, NUL, control characters, non-ASCII) are refused at construction;
# * no caller-supplied value can become an HTTP header (no header injection);
# * redirects are never followed (that would forward the API key to another host);
# * plain http:// is refused for remote hosts;
# * address and base64 parsing are linear (no ReDoS on 100k-character inputs);
# * the SDK never shadows Object#send;
# * prototype-style junk in server JSON is inert in Ruby.
class SecretDisclosureTest < UnsentTestCase
  KEY = 'sk_live_api_key_0123456789'
  SECRET = 'sk_live_api_secret_abcdefghijkl'

  def leaky?(text)
    s = text.to_s
    s.include?(KEY) || s.include?(SECRET)
  end

  def client(**opts)
    Unsent::Client.new(base_url: BASE, api_key: KEY, api_secret: SECRET, transport: MockTransport.new, env: {},
                       **opts)
  end

  def assert_clean(label, text)
    refute leaky?(text), "#{label} leaked a credential: #{text.inspect[0, 300]}"
    refute_includes text.to_s, KEY
    refute_includes text.to_s, SECRET
  end

  def test_client_rendering_never_discloses_credentials
    c = client
    assert_clean('inspect', c.inspect)
    assert_clean('to_s', c.to_s)
    assert_clean('string interpolation', "#{c}")
    assert_clean('pp', PP.pp(c, +''))
    assert_clean('JSON.generate', JSON.generate(c))
    assert_clean('to_json', c.to_json)
    assert_clean('as_json', c.as_json.inspect)
    assert_clean('p output', c.pretty_inspect)
    assert_equal '{}', JSON.generate(c), 'the client serializes to an empty object'
    assert_includes c.inspect, Unsent::Secret::REDACTED
  end

  def test_emails_resource_and_http_layer_never_disclose_credentials
    c = client
    assert_clean('emails#inspect', c.emails.inspect)
    assert_clean('emails#pp', PP.pp(c.emails, +''))
    http = c.instance_variable_get(:@http)
    assert_clean('http#inspect', http.inspect)
    assert_clean('http fields', http.instance_variables.map { |v| http.instance_variable_get(v).inspect }.join(' '))
  end

  def test_requests_and_secrets_render_redacted
    req = Unsent::Transport::Request.new(method: 'POST', url: "#{BASE}/api/send",
                                        headers: { 'X-API-Key' => KEY, 'X-Signature' => 'sha256=abc' },
                                        body: '{"to":["a@b.co"]}')
    assert_clean('request#inspect', req.inspect)
    assert_clean('request#to_s', req.to_s)
    assert_clean('request#pp', PP.pp(req, +''))
    assert_equal KEY, req.header('x-api-key'), 'the header itself is still readable by the transport'

    secret = Unsent::Secret.new(SECRET)
    [secret.inspect, secret.to_s, PP.pp(secret, +''), JSON.generate(secret), secret.as_json, secret.to_yaml].each do |text|
      assert_clean('Unsent::Secret rendering', text)
    end
    assert_equal SECRET, secret.reveal
  end

  def test_error_messages_bodies_and_to_h_never_disclose_credentials
    # A hostile/buggy server that echoes the request into the error, including the headers it received.
    body = { error: "Unauthorized for key #{KEY}", code: 'invalid_signature',
             reason: "signature computed with #{SECRET} did not match", echo: { 'X-API-Key' => KEY } }
    c = Unsent::Client.new(base_url: BASE, api_key: KEY, api_secret: SECRET, env: {}, max_retries: 0,
                           transport: MockTransport.new { json(body, 401) })
    err = assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_clean('error message', err.message)
    assert_clean('error inspect', err.inspect)
    assert_clean('error to_h', err.to_h.inspect)
    assert_clean('error to_h JSON', JSON.generate(err.to_h))
    assert_clean('error body', err.body.inspect)
    assert_clean('error reason', err.reason)
    assert_includes err.message, Unsent::Secret::REDACTED
  end

  def test_transport_failures_do_not_echo_credentials
    c = Unsent::Client.new(base_url: BASE, api_key: KEY, api_secret: SECRET, env: {}, max_retries: 0,
                           transport: MockTransport.new { raise IOError, "socket died while sending X-API-Key: #{KEY}" })
    err = assert_raises(Unsent::ConnectionError) { c.send_email(**MSG) }
    assert_clean('connection error message', err.message)
    assert_clean('connection error to_h', JSON.generate(err.to_h))
  end

  def test_api_key_is_never_part_of_a_successful_result
    c = Unsent::Client.new(base_url: BASE, api_key: KEY, api_secret: SECRET, env: {},
                           transport: MockTransport.new { accepted(1) })
    res = c.send_email(**MSG)
    assert_clean('send result', res.inspect)
    assert_clean('send result to_h', JSON.generate(res.to_h))
  end

  def test_client_cannot_be_marshaled
    assert_raises(TypeError) { Marshal.dump(client) }
    assert_raises(TypeError) { Marshal.dump(Unsent::Secret.new(SECRET)) }
  end
end

class CredentialInjectionTest < UnsentTestCase
  # A credential that could smuggle anything into a header must be refused outright, at construction.
  BAD_KEYS = [
    "key\r\nX-Injected: 1", "key\nX-Injected: 1", "key\rX-Injected: 1", "key\0", "key\tvalue", "key\x01",
    "key\x1b[31m", 'key ünïcode', "k\u00e9y", "\uFFFD", "key\x7f", "a b\nc"
  ].freeze

  CASES = BAD_KEYS.product(%i[api_key api_secret]).freeze

  CASES.each_with_index do |(value, field), i|
    define_method("test_rejects_#{field}_case_#{i}") do
      opts = { base_url: BASE, api_key: 'ok-key', api_secret: 'ok-secret', env: {}, transport: MockTransport.new }
      opts[field] = value
      err = assert_raises(Unsent::ConfigError, "#{field} #{value.inspect}") { Unsent::Client.new(opts) }
      assert_equal 'invalid_config', err.code
      assert_match(/printable ASCII|NUL character/, err.message)
      assert_includes err.message, field.to_s
    end
  end

  def test_non_ascii_and_control_char_free_but_untrimmed_credentials_are_trimmed
    t = MockTransport.new { accepted }
    c = Unsent::Client.new(base_url: "#{BASE}\n", api_key: "  api-key-value \r\n", api_secret: "\tsecret-value\n",
                          env: {}, transport: t)
    c.send_email(**MSG)
    req = t.calls[0]
    assert_equal 'api-key-value', req.header('X-API-Key')
    expected = hmac_sha256_hex('secret-value', "#{req.header('X-Timestamp')}\n#{req.header('X-Nonce')}\n" \
                                               "#{Digest::SHA256.hexdigest(req.body)}")
    assert_equal "sha256=#{expected}", req.header('X-Signature'), 'the trimmed secret is what signs'
  end

  def test_credentials_that_are_not_strings_or_utf8_are_rejected
    [42, :sym, [], {}, true, "\xff\xfe".dup.force_encoding('UTF-8')].each do |bad|
      assert_raises(Unsent::ConfigError, bad.inspect) do
        Unsent::Client.new(base_url: BASE, api_key: bad, env: {}, transport: MockTransport.new)
      end
      assert_raises(Unsent::ConfigError, bad.inspect) do
        Unsent::Client.new(base_url: BASE, api_key: 'k', api_secret: bad, env: {}, transport: MockTransport.new)
      end
    end
  end
end

class HeaderInjectionTest < UnsentTestCase
  INJECTIONS = [
    "x\r\nX-Injected: 1", "x\nX-Injected: 1", "x\rX-Injected: 1", 'x%0d%0aX-Injected: 1',
    "\r\nBcc: attacker@evil.test", "subject\0tail"
  ].freeze

  def assert_no_injection(recorded, marker = 'X-Injected')
    recorded.headers.each do |name, value|
      refute_match(/[\r\n\0]/, name.to_s, 'header names must never contain CR/LF/NUL')
      refute_match(/[\r\n\0]/, value.to_s, 'header values must never contain CR/LF/NUL')
      refute_includes value.to_s, marker
    end
    # And the raw bytes on the wire are a single header block: no CR/LF/LF-only sequence ends a header early.
    refute_match(/[\r\n]#{Regexp.escape(marker)}/i, recorded.body)
  end

  def test_subject_cannot_inject_a_header
    c, t = setup_client { accepted }
    c.send_email(to: 'a@b.co', subject: "Hello\r\nX-Injected: 1", html: '<p>x</p>')
    req = t.calls[0]
    assert_no_injection(req)
    assert_equal "Hello\r\nX-Injected: 1", req.json['subject'], 'the subject is carried as JSON data, not a header'
    assert_equal %w[accept x-api-key content-type user-agent x-timestamp x-nonce x-signature].sort, req.headers.keys.map(&:downcase).sort
  end

  def test_attachment_filename_cannot_inject_a_header
    c, t = setup_client { accepted }
    c.send_email(**MSG, attachments: [{ filename: "invoice\r\nX-Injected: 1.pdf", content: 'hi'.b }])
    req = t.calls[0]
    assert_no_injection(req)
    assert_equal 'invoiceX-Injected: 1.pdf', req.json['attachments'][0]['filename'],
                 'CR/LF are stripped from filenames rather than allowed through'
  end

  def test_attachment_content_type_cannot_inject_a_header
    c, t = setup_client { accepted }
    ['text/plain', "text/plain\r\nX-Injected: 1", "text/plain\nX-Injected: 1"].each do |mime|
      c.send_email(**MSG, attachments: [{ filename: 'a.txt', content: 'hi'.b, content_type: mime }])
    end
    t.calls.each { |r| assert_no_injection(r) }
    assert_equal "text/plain\r\nX-Injected: 1", t.calls[1].json['attachments'][0]['mimeType']
  end

  def test_senders_and_recipients_can_never_reach_a_header
    c, t = setup_client { accepted }
    # Percent-encoded CRLF is inert: it is carried as JSON *data* and never decoded into a header.
    c.send_email(**MSG, from: 'a@b.co%0d%0aX-Injected: 1')
    assert_no_injection(t.calls[0])
    assert_equal({ 'email' => 'a@b.co%0d%0aX-Injected: 1' }, t.calls[0].json['from'])

    INJECTIONS.each do |evil|
      next if evil.start_with?('x%') # covered above: no literal CR/LF

      assert_raises(Unsent::ValidationError, evil.inspect) { c.send_email(to: "a@b.co#{evil}", **MSG.except(:to)) }
      assert_raises(Unsent::ValidationError, evil.inspect) { c.send_email(**MSG, from: "a@b.co#{evil}") }
      begin
        # A display name is trimmed, so a *leading* CRLF is removed before validation; anything that survives
        # must reach the wire as JSON data with no line break in it.
        c.send_email(**MSG, from: { email: 'a@b.co', name: evil })
        refute_match(/[\r\n\0]/, t.calls.last.json['from']['name'].to_s, evil.inspect)
      rescue Unsent::ValidationError
        nil
      end
      assert_raises(Unsent::ValidationError, evil.inspect) { c.send_email(**MSG, cc: "c@d.co#{evil}") }
      assert_raises(Unsent::ValidationError, evil.inspect) { c.send_email(**MSG, bcc: "c@d.co#{evil}") }
    end
    t.calls.each { |r| assert_no_injection(r) }
  end

  def test_idempotency_key_and_provider_id_can_never_reach_a_header
    c, t = setup_client { accepted }
    INJECTIONS.each do |evil|
      err = assert_raises(Unsent::ValidationError, evil.inspect) { c.send_email(**MSG, idempotency_key: evil) }
      assert_equal 'invalid_idempotency_key', err.code
    end
    assert_no_requests t
    # provider_id has no header to reach: the SDK never sends X-Provider-Id / X-Sender-Email / Idempotency-Key.
    c.send_email(**MSG, provider_id: "p\r\nX-Injected: 1", idempotency_key: 'a-key')
    req = t.calls[0]
    %w[X-Provider-Id X-Sender-Email Idempotency-Key].each { |h| assert_nil req.header(h), h }
    assert_no_injection(req)
    assert_equal "p\r\nX-Injected: 1", req.json['provider_id'], 'it is signed body data only'
  end

  def test_default_from_cannot_carry_a_header_into_a_send
    assert_raises(Unsent::ConfigError) do
      Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: {}, transport: MockTransport.new,
                         default_from: "a@b.co\r\nX-Injected: 1")
    end
    assert_raises(Unsent::ConfigError) do
      Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: {}, transport: MockTransport.new,
                         default_from: { email: 'a@b.co', name: "x\nX-Injected: 1" })
    end
  end
end

class RedirectTest < UnsentTestCase
  REDIRECTS = [301, 302, 303, 307, 308].freeze

  def test_redirects_are_refused_for_every_method_and_status
    REDIRECTS.each do |status|
      t = MockTransport.new { raw(status, '', 'Location' => 'https://attacker.test/api/send') }
      c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, api_secret: API_SECRET, env: {},
                             transport: t, clock: FakeClock.new)
      err = assert_raises(Unsent::Error, status.to_s) { c.send_email(**MSG) }
      assert_equal 'unexpected_redirect', err.code
      refute_kind_of Unsent::APIError, err
      assert_equal 1, t.calls.length, 'a redirect must not be retried or followed'
      assert_equal 'unsent.test', t.calls[0].url.host
      # GETs too
      err = assert_raises(Unsent::Error) { c.status }
      assert_equal 'unexpected_redirect', err.code
      err = assert_raises(Unsent::Error) { c.emails.get(1) }
      assert_equal 'unexpected_redirect', err.code
      assert_equal 3, t.calls.length, 'each call made exactly one request'
    end
  end

  def test_a_real_301_to_another_server_receives_no_request_at_all
    elsewhere = TinyServer.new { |*| TinyServer.http(202, '{"id":1,"status":"queued"}') }
    origin = TinyServer.new do |_line, _headers, _body, _sock|
      TinyServer.http(301, '', 'Location' => "#{elsewhere.base_url}/api/send")
    end
    c = Unsent::Client.new(base_url: origin.base_url, api_key: API_KEY, api_secret: API_SECRET, env: {},
                           max_retries: 0)
    err = assert_raises(Unsent::Error) { c.send_email(**MSG) }
    assert_equal 'unexpected_redirect', err.code
    assert_match(%r{redirected to #{Regexp.escape(elsewhere.base_url)}}, err.message)
    assert_equal 1, origin.requests.length
    assert_empty elsewhere.requests, 'the second host must never see the API key'
  ensure
    origin&.stop
    elsewhere&.stop
  end

  def test_a_redirect_chain_is_not_walked
    # A server that always redirects: a client that followed would loop (or ping-pong) forever.
    hops = []
    server = TinyServer.new do |line, _headers, _body, _sock|
      hops << line
      TinyServer.http(302, '', 'Location' => '/redirected')
    end
    c = Unsent::Client.new(base_url: server.base_url, api_key: API_KEY, env: {}, max_retries: 10)
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'unexpected_redirect', err.code
    assert_equal 1, hops.length
  ensure
    server&.stop
  end

  def test_no_location_header_is_still_a_clean_error
    c, t = setup_client { raw(303, '') }
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'unexpected_redirect', err.code
    assert_match(/redirected\./, err.message)
    assert_equal 1, t.calls.length
  end

  def test_a_control_character_location_is_sanitized_in_the_message
    c, = setup_client { raw(302, '', 'Location' => "https://x.test/\r\nSet-Cookie: a=b") }
    err = assert_raises(Unsent::Error) { c.status }
    refute_includes err.message, "\r"
    refute_includes err.message, "\n"
  end
end

class TransportSecurityTest < UnsentTestCase
  def test_plain_http_is_refused_for_remote_hosts
    %w[http://unsent.example.com http://api.example.com:8080 https://ok.test http://10.0.0.5 http://192.168.1.9
       http://evil-localhost.com http://localhost.evil.test http://127.0.0.2].each do |url|
      next unless url.start_with?('http://')

      err = assert_raises(Unsent::ConfigError, url) do
        Unsent::Client.new(base_url: url, api_key: 'k', env: {}, transport: MockTransport.new)
      end
      assert_match(/plain http/, err.message, url)
    end
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(base_url: 'https://ok.test', api_key: 'k', env: {}, transport: 1) }
  end

  def test_plain_http_is_allowed_only_for_loopback
    %w[localhost 127.0.0.1 [::1] app.localhost].each do |host|
      c = Unsent::Client.new(base_url: "http://#{host}:8787", api_key: 'k', env: {}, transport: MockTransport.new)
      assert_equal "http://#{host}:8787", c.base_url
    end
  end

  def test_embedded_credentials_and_other_schemes_are_refused
    ['https://user:pw@unsent.test', 'https://user@unsent.test', 'ftp://unsent.test', 'file:///etc/passwd',
     'javascript:alert(1)', 'data:text/html,x'].each do |url|
      assert_raises(Unsent::ConfigError, url) do
        Unsent::Client.new(base_url: url, api_key: 'k', env: {}, transport: MockTransport.new)
      end
    end
  end

  def test_the_default_transport_verifies_tls_peers
    http = Unsent::Transport::NetHTTP.new
    configured = []
    fake = Object.new
    fake.define_singleton_method(:use_ssl=) { |v| configured << [:use_ssl, v] }
    fake.define_singleton_method(:verify_mode=) { |v| configured << [:verify_mode, v] }
    fake.define_singleton_method(:min_version=) { |v| configured << [:min_version, v] }
    fake.define_singleton_method(:open_timeout=) { |v| configured << [:open_timeout, v] }
    fake.define_singleton_method(:read_timeout=) { |v| configured << [:read_timeout, v] }
    fake.define_singleton_method(:write_timeout=) { |v| configured << [:write_timeout, v] }
    fake.define_singleton_method(:keep_alive_timeout=) { |v| configured << [:keep_alive_timeout, v] }
    http.send(:configure, fake, URI.parse('https://unsent.test'), 5)
    assert_includes configured, [:use_ssl, true]
    assert_includes configured, [:verify_mode, OpenSSL::SSL::VERIFY_PEER]
    assert_includes configured, [:min_version, OpenSSL::SSL::TLS1_2_VERSION]
  end
end

class ReDoSTest < UnsentTestCase
  BUDGET = 1.0 # seconds for the whole pathological battery

  def elapsed
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    yield
    Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
  end

  PATHOLOGICAL = [
    ' ' * 100_000, '<' * 100_000, '>' * 100_000, '"' * 100_000, '@' * 100_000, '=' * 100_000,
    ('a <' * 50_000), ('<>' * 50_000), ('a@b.co <' * 20_000), ('x' * 100_000) + '>', '<' + ('a' * 100_000) + '>',
    ('"' * 50_000) + '<a@b.co>', ('Name <a@b.co> ' * 8_000), ('a' * 100_000), ("a\n" * 50_000),
    ("\r\n" * 50_000), ('   ' * 33_333)
  ].freeze

  def test_address_parsing_is_linear
    calls = 0
    total = elapsed do
      PATHOLOGICAL.each do |input|
        [[-> { Unsent::Address.parse(input, 'from') }],
         [-> { Unsent::Address.recipients(input, 'to', true) }],
         [-> { Unsent::Address.recipients([input] * 3, 'to', true) }]].flatten.each do |call|
          calls += 1
          begin
            call.call
          rescue Unsent::ValidationError
            nil # rejecting it is the expected outcome for most of these
          end
        end
      end
    end
    assert_equal PATHOLOGICAL.length * 3, calls, 'every pathological input must be examined'
    assert_operator total, :<, BUDGET, "pathological address parsing took #{total.round(3)} s"
  end

  def test_base64_validation_is_linear
    calls = 0
    total = elapsed do
      (PATHOLOGICAL + ['A' * 100_000, ('QQ==' * 25_000) + '=', ('A' * 99_999) + 'B', '=' * 100_000,
                       ("AAAA\n" * 25_000), ' ' * 100_000]).each do |input|
        calls += 1
        begin
          Unsent::Attachment.to_wire({ filename: 'a.txt', content: input }, 0)
        rescue Unsent::ValidationError
          nil # invalid base64 (or too large) is fine; taking forever is not
        end
      end
    end
    assert_operator calls, :>, 20
    assert_operator total, :<, BUDGET, "pathological base64 validation took #{total.round(3)} s"
  end

  def test_send_validation_is_linear_on_hostile_fields
    c, t = setup_client { accepted }
    total = elapsed do
      PATHOLOGICAL.each do |input|
        [-> { c.send_email(**MSG, from: input) }, -> { c.send_email(**MSG, to: input) },
         -> { c.send_email(**MSG, idempotency_key: input) }, -> { c.send_email(**MSG, provider_id: input) }].each do |call|
          begin
            call.call
          rescue Unsent::ValidationError
            nil
          end
        end
      end
    end
    assert_operator total, :<, BUDGET, "pathological send validation took #{total.round(3)} s"
    # Whatever slipped through validation was carried as JSON data — never as a header.
    t.calls.each do |req|
      req.headers.each_value { |v| refute_match(/[\r\n\0]/, v.to_s) }
    end
  end

  def test_pathological_retry_after_and_date_headers_are_cheap
    total = elapsed do
      ['9' * 100_000, ('Mon, ' * 25_000), ('0' * 100_000), ('-' * 100_000), (Time.now.httpdate * 3_000)].each do |value|
        c, = setup_client(max_retries: 0) { |r| r.n == 1 ? api_error(503, 'x', 'e', nil, 'Retry-After' => value) : accepted }
        assert_raises(Unsent::ServerError) { c.send_email(**MSG) }
        c2, = setup_client { |r| r.n == 1 ? api_error(401, 'timestamp_skew', 'e', nil, 'Date' => value) : accepted }
        assert_raises(Unsent::AuthenticationError) { c2.send_email(**MSG) }
      end
    end
    assert_operator total, :<, BUDGET, "pathological header parsing took #{total.round(3)} s"
  end

  def test_a_hundred_thousand_character_body_is_rejected_quickly
    c, t = setup_client { accepted }
    total = elapsed do
      assert_raises(Unsent::ValidationError) { c.send_email(**MSG, subject: 'x' * 1_000_000) }
      assert_raises(Unsent::ValidationError) { c.send_email(**MSG, html: 'x' * (4 * 1024 * 1024)) }
      assert_raises(Unsent::ValidationError) { c.send_email(**MSG, to: Array.new(10_000) { |i| "u#{i}@x.co" }) }
    end
    assert_operator total, :<, BUDGET
    assert_no_requests t
  end
end

class RubySemanticsTest < UnsentTestCase
  def test_object_send_still_works_on_every_public_object
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: {}, transport: MockTransport.new)
    assert_equal BASE, c.send(:base_url)
    assert_equal BASE, c.public_send(:base_url)
    assert_equal BASE, c.__send__(:base_url)
    assert_equal c.emails, c.send(:emails)
    refute_includes Unsent::Client.instance_methods(false), :send
    refute_includes Unsent::Emails.instance_methods(false), :send
    refute_includes Unsent::Error.instance_methods(false), :send
    refute_includes Unsent::Attachment.singleton_methods(false), :send
    # Metaprogramming through the client is unaffected.
    assert_includes c.methods, :send_email
    assert_equal 'Unsent::Client', c.send(:class).name
  end

  def test_no_public_method_shadows_a_common_object_method
    shadowed = Unsent::Client.instance_methods(false) & %i[send __send__ public_send method_missing
                                                       object_id class is_a? instance_of? hash freeze]
    assert_empty shadowed
  end

  def test_frozen_client_cannot_be_mutated_into_leaking
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, api_secret: API_SECRET, env: {},
                           transport: MockTransport.new)
    assert_predicate c, :frozen?
    assert_predicate c.emails, :frozen?
    assert_raises(FrozenError) { c.instance_variable_set(:@api_key, 'x') }
  end
end

class PrototypeJunkTest < UnsentTestCase
  POLLUTED = [
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"id":1,"status":"sent","to":["a@b.co"]}',
    '{"email":{"__proto__":{"polluted":true},"id":2,"status":"queued","to":["a@b.co"],"__proto__":"x"}}',
    '{"emails":[{"__proto__":1,"id":3,"status":"sent","to":["a@b.co"]}],"total":1,"__proto__":{"a":1}}',
    '{"queued":1,"sending":0,"sent":0,"failed":0,"__proto__":{"polluted":true},"constructor":"x"}',
    '{"status":"ok","__proto__":{"polluted":true},"timestamp":1780000000000}'
  ].freeze

  def test_proto_style_keys_are_inert
    POLLUTED.each do |body|
      t = MockTransport.new { raw(200, body) }
      c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: {}, transport: t, clock: FakeClock.new)
      # None of these may raise anything but an SDK error, and nothing may be polluted afterwards.
      [-> { c.status }, -> { c.health }, -> { c.emails.get(1) }, -> { c.emails.list },
       -> { c.emails.each(limit: 1).to_a }, -> { c.emails.wait(1, timeout: 0.01) }].each do |call|
        begin
          call.call
        rescue Unsent::Error
          nil
        end
      end
    end
    refute Object.new.respond_to?(:polluted), 'no prototype-style pollution may leak into Object'
    refute Hash.new.respond_to?(:polluted)
    refute_includes Object.instance_methods, :polluted
    refute Hash.method_defined?(:polluted)
    refute Object.method_defined?(:polluted)
    refute Hash.new.key?('polluted')
  end

  def test_proto_style_keys_in_a_send_response_do_not_change_the_result
    c, = setup_client do
      json({ '__proto__' => { 'polluted' => true }, 'id' => 5, 'status' => 'queued', 'constructor' => { 'x' => 1 } }, 202)
    end
    res = c.send_email(**MSG)
    assert_equal 5, res.id
    assert_equal 'queued', res.status
    refute_respond_to res, :polluted
  end

  def test_nested_junk_in_an_email_never_crashes_and_never_pollutes
    junk_row = { 'id' => 1, 'status' => 'sent', 'to' => ['a@b.co'], '__proto__' => { 'polluted' => true },
                 'constructor' => { 'prototype' => { 'polluted' => true } }, 'attachments' => [{ '__proto__' => 1 }],
                 'failover_history' => '[{"__proto__":{"polluted":true}}]' }
    c, = setup_client { json('email' => junk_row) }
    e = c.emails.get(1)
    assert_equal 1, e.id
    assert_equal 1, e.failover_history.length
    refute_respond_to Object.new, :polluted
  end

  def test_json_with_a_deeply_nested_structure_is_handled
    deep = ('{"a":' * 2_000) + '1' + ('}' * 2_000)
    t = MockTransport.new { raw(200, deep) }
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: {}, transport: t, max_retries: 0)
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'invalid_response', err.code
  end
end
