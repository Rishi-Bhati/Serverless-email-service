# frozen_string_literal: true

$LOAD_PATH.unshift File.expand_path('../lib', __dir__)
require 'minitest/autorun'
require 'set'
require 'tempfile'
require 'tmpdir'
require 'pathname'
require 'digest'
require 'json'
require 'securerandom'
require 'stringio'
require 'unsent'

# Shared test tooling: a recording mock transport, a virtual clock, an independent re-implementation of the
# server's signature check, and response builders.
module UnsentTest
  BASE = 'https://unsent.test'
  API_KEY = 'test-api-key'
  API_SECRET = 'test-api-secret'

  # A request as seen by the mock transport.
  Recorded = Struct.new(:request, :n, keyword_init: true) do
    def method = request.method
    def url = URI.parse(request.url)
    def path = url.path
    def query = URI.decode_www_form(url.query.to_s).to_h
    def headers = request.headers
    def header(name) = request.header(name)
    def body = request.body.to_s
    def json = body.empty? ? nil : JSON.parse(body)
  end

  # Virtual time: sleeping advances the clock instantly, so retry/backoff/wait scenarios run in microseconds
  # while still being observable (+slept+).
  class FakeClock
    attr_reader :slept
    attr_accessor :skew

    def initialize(start: Time.now.to_f, skew: 0.0)
      @t = start
      @mono = 1000.0
      @skew = skew
      @slept = []
      @lock = Mutex.new
    end

    def now = @lock.synchronize { @t + @skew }
    def monotonic = @lock.synchronize { @mono }

    def sleep(seconds, cancel = nil)
      return if cancel&.cancelled?

      @lock.synchronize do
        @slept << seconds
        @t += seconds
        @mono += seconds
      end
      nil
    end

    def advance(seconds)
      @lock.synchronize do
        @t += seconds
        @mono += seconds
      end
    end
  end

  # Records requests and delegates to a handler `(Recorded) -> Response`. Thread-safe.
  class MockTransport
    attr_reader :calls

    def initialize(&handler)
      @handler = handler || ->(_r) { UnsentTest.accepted }
      @calls = []
      @lock = Mutex.new
    end

    def call(request)
      rec = @lock.synchronize { Recorded.new(request: request, n: (@calls << nil).length).tap { |r| @calls[-1] = r } }
      @handler.call(rec)
    end

    def paths = calls.map(&:path)
  end

  module_function

  def json(data, status = 200, headers = {})
    Unsent::Transport::Response.new(status: status, headers: { 'Content-Type' => 'application/json' }.merge(headers),
                                    body: JSON.generate(data))
  end

  def accepted(id = 1, extra = {})
    json({ success: true, id: id, status: 'queued', idempotent_replay: false, message: 'Email successfully queued for sending',
           targetProvider: 'Automatic Priority / Default' }.merge(extra), 202)
  end

  def api_error(status, code, error = 'Error', reason = nil, headers = {})
    json({ error: error, code: code }.merge(reason ? { reason: reason } : {}), status, headers)
  end

  def raw(status, body, headers = {})
    Unsent::Transport::Response.new(status: status, headers: headers, body: body)
  end

  # --- an independent implementation of the server's checks (src/auth.ts, `full` mode, no routing headers) ---

  # HMAC-SHA256 written out from RFC 2104 on top of a plain SHA-256 digest, so it shares no code with the SDK
  # (which uses OpenSSL::HMAC).
  def hmac_sha256_hex(key, message)
    block = 64
    key = Digest::SHA256.digest(key) if key.bytesize > block
    key = key.b.ljust(block, "\0".b)
    ipad = key.bytes.map { |b| b ^ 0x36 }.pack('C*')
    opad = key.bytes.map { |b| b ^ 0x5c }.pack('C*')
    Digest::SHA256.hexdigest(opad + Digest::SHA256.digest(ipad + message.b))
  end

  def verify_signed(rec, secret = API_SECRET, used_nonces = nil, now: nil)
    return [false, 'invalid_api_key'] unless rec.header('X-API-Key') == API_KEY

    ts = rec.header('X-Timestamp').to_s
    now ||= Time.now.to_f
    return [false, 'timestamp_skew'] unless ts.match?(/\A\d+\z/) && (now - ts.to_i).abs <= 180

    nonce = rec.header('X-Nonce').to_s
    return [false, 'invalid_nonce'] unless nonce.match?(/\A[a-zA-Z0-9_-]{8,128}\z/)

    sig = rec.header('X-Signature').to_s.sub(/\Asha256=/, '').downcase
    expected = hmac_sha256_hex(secret, "#{ts}\n#{nonce}\n#{Digest::SHA256.hexdigest(rec.body)}")
    return [false, 'invalid_signature'] unless sig == expected

    if used_nonces
      return [false, 'nonce_reused'] unless used_nonces.add?(nonce)
    end
    if rec.header('X-Provider-Id') || rec.header('X-Sender-Email') || rec.header('Idempotency-Key')
      return [false, 'invalid_signature']
    end

    [true, nil]
  end

  def client(transport = nil, clock: FakeClock.new, **opts, &handler)
    transport ||= MockTransport.new(&handler)
    Unsent::Client.new(base_url: BASE, api_key: API_KEY, api_secret: API_SECRET, transport: transport, clock: clock,
                       env: {}, **opts)
  end

  MSG = { to: 'a@b.co', subject: 's', html: 'h' }.freeze
end

class UnsentTestCase < Minitest::Test
  include UnsentTest

  # Runs the block with a transport/client pair. Returns [client, transport, clock].
  def setup_client(clock: FakeClock.new, **opts, &handler)
    transport = MockTransport.new(&handler)
    [UnsentTest.client(transport, clock: clock, **opts), transport, clock]
  end

  def assert_raises_code(klass, code)
    err = assert_raises(klass) { yield }
    assert_equal code, err.code
    err
  end

  def assert_no_requests(transport)
    assert_equal 0, transport.calls.length, 'no request must have been sent'
  end
end
