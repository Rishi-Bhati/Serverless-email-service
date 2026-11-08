# frozen_string_literal: true

require_relative '../test_helper'
require 'socket'

# Live end-to-end tests against a real Unsent worker (`wrangler dev` + local SMTP sink), SPEC.md §7.4.
#
#   eval "$(scripts/e2e-server.sh start 8830)"   # exports UNSENT_E2E_* variables
#   rake test:e2e
#   scripts/e2e-server.sh stop 8830
#
# Every test is skipped unless UNSENT_E2E_BASE_URL is set, so plain unit runs ignore this file.
module E2E
  ENV_URL = ENV.fetch('UNSENT_E2E_BASE_URL', '').strip
  KEY = ENV.fetch('UNSENT_E2E_API_KEY', '')
  SECRET = ENV.fetch('UNSENT_E2E_API_SECRET', '')
  FROM = ENV.fetch('UNSENT_E2E_FROM', '')
  MODE = ENV.fetch('UNSENT_E2E_MODE', 'full').strip
  MAILS_FILE = ENV.fetch('UNSENT_E2E_MAILS_FILE', '')
  TIMEOUT = 30

  module_function

  def enabled? = !ENV_URL.empty?
  def signed? = MODE != 'api-key-only'

  def uid = format('%08x', SecureRandom.random_number(2**32))

  # A client talking to the live worker. `overrides` are Client options.
  def client(**overrides)
    Unsent::Client.new(**{ base_url: ENV_URL, api_key: KEY, api_secret: SECRET, default_from: FROM,
                           timeout: 30, max_retries: 3, env: {} }.merge(overrides))
  end

  def mails
    return [] if MAILS_FILE.empty? || !File.exist?(MAILS_FILE)

    File.readlines(MAILS_FILE).filter_map do |line|
      next if line.strip.empty?

      JSON.parse(line)['raw']
    rescue JSON::ParserError
      nil
    end
  end
end

class E2ETestCase < UnsentTestCase
  def setup
    super
    skip 'UNSENT_E2E_BASE_URL not set' unless E2E.enabled?
  end

  def client(**overrides) = E2E.client(**overrides)

  def wait_sent(id, **opts)
    client.emails.wait(id, **{ timeout: E2E::TIMEOUT, interval: 0.2 }.merge(opts))
  end
end

class E2EHealthTest < E2ETestCase
  def test_health_and_authenticated_status
    c = client
    h = c.health
    assert_equal 'ok', h.status
    refute_empty h.runtime
    assert_in_delta Time.now.to_f, h.timestamp.to_f, 120
    assert_predicate h, :ok?

    s = c.status
    [s.queued, s.sending, s.sent, s.failed].each { |n| assert_kind_of Integer, n; assert_operator n, :>=, 0 }
  end

  def test_health_needs_no_credentials_but_status_does
    anonymous = Unsent::Client.new(base_url: E2E::ENV_URL, api_key: 'nope', api_secret: nil, env: {}, max_retries: 0)
    assert_equal 'ok', anonymous.health.status
    err = assert_raises(Unsent::AuthenticationError) { anonymous.status }
    assert_equal 401, err.status
  end
end

class E2ESendTest < E2ETestCase
  def test_a_text_only_email_is_delivered
    c = client
    tag = E2E.uid
    res = c.send_email(to: "rcpt-#{tag}@example.com", subject: "e2e text #{tag}", text: 'Plain *text* <ok>')
    assert_operator res.id, :>, 0
    assert_equal 'queued', res.status
    assert_equal false, res.idempotent_replay
    refute_nil res.idempotency_key

    e = wait_sent(res.id)
    # The server only increments `attempts` on failure, so a first-try delivery still reports 0.
    assert_equal 'sent', e.status
    assert_equal ["rcpt-#{tag}@example.com"], e.to
    assert_equal 'Plain *text* <ok>', e.text_body
    assert_includes e.html_body, 'Plain *text* &lt;ok&gt;'
    assert_equal res.idempotency_key, e.idempotency_key
    assert_equal E2E::FROM, e.from_email
    assert_in_delta Time.now.to_f, e.created_at.to_f, 120
    assert_operator e.updated_at, :>=, e.created_at
    assert_predicate e, :sent?
    assert_predicate e, :final?
  end

  def test_a_full_message_round_trips_byte_exact
    c = client
    tag = E2E.uid
    blob = (0..255).map { |i| i.chr }.join.b * 40
    res = c.send_email(
      from: { email: E2E::FROM, name: 'E2E Sender' },
      to: ["a-#{tag}@example.com", "b-#{tag}@example.com"],
      cc: "c-#{tag}@example.com",
      bcc: ["d-#{tag}@example.com"],
      subject: "e2e full #{tag} Grüße 🎉 日本語",
      html: "<h1>#{tag} 🎉</h1>",
      text: "text #{tag} ünï",
      attachments: [
        { filename: 'bytes.bin', content: blob, content_type: 'application/octet-stream' },
        { filename: 'hello.txt', content: 'aGVsbG8=', content_type: 'text/plain' },
        { filename: 'ünï.txt', content: 'héllo 🎉'.b, content_type: 'text/plain' }
      ]
    )
    e = wait_sent(res.id)
    assert_equal 'sent', e.status
    assert_equal 'E2E Sender', e.from_name
    assert_equal ["a-#{tag}@example.com", "b-#{tag}@example.com"], e.to
    assert_equal ["c-#{tag}@example.com"], e.cc
    assert_equal ["d-#{tag}@example.com"], e.bcc
    assert_equal "text #{tag} ünï", e.text_body
    assert_equal "<h1>#{tag} 🎉</h1>", e.html_body
    assert_equal "e2e full #{tag} Grüße 🎉 日本語", e.subject

    atts = e.attachments
    assert_equal 3, atts.length
    assert_equal ['bytes.bin', blob.bytesize, 'application/octet-stream'], [atts[0].filename, atts[0].size, atts[0].mime_type]
    assert_equal ['hello.txt', 5, 'text/plain'], [atts[1].filename, atts[1].size, atts[1].mime_type]
    assert_equal ['ünï.txt', 'héllo 🎉'.bytesize, 'text/plain'], [atts[2].filename, atts[2].size, atts[2].mime_type]
    assert_equal blob, atts[0].data, 'the binary attachment must round-trip byte for byte'
    assert_equal 'hello', atts[1].data
    assert_equal 'héllo 🎉', atts[2].data.force_encoding('UTF-8')

    # The list endpoint gives attachment metadata only.
    row = c.emails.list(search: tag, limit: 200).emails.find { |x| x.id == res.id }
    refute_nil row, 'the email must appear in a list'
    assert_equal [['bytes.bin', blob.bytesize], ['hello.txt', 5], ['ünï.txt', 'héllo 🎉'.bytesize]],
                 row.attachments.map { |a| [a.filename, a.size] }
    refute_respond_to row.attachments[0], :content

    raw = E2E.mails.find { |m| m.include?("a-#{tag}@example.com") }
    unless E2E::MAILS_FILE.empty?
      refute_nil raw, 'the SMTP sink did not receive the message'
      refute_empty raw
      assert_includes raw, 'bytes.bin'
      assert_includes raw, 'hello.txt'
    end
  end

  def test_unicode_everywhere_round_trips
    c = client
    tag = E2E.uid
    subject = "Grüße 日本語 🎉 #{tag}"
    text = "Zażółć gęślą jaźń — “quotes” \\ \"q\" 'a' <&> \n\ttabbed 👨‍👩‍👧‍👦"
    res = c.send_email(to: "üser-#{tag}@example.com", subject: subject, text: text,
                       html: "<p>#{text.gsub('&', '&amp;').gsub('<', '&lt;')}</p>")
    e = wait_sent(res.id)
    assert_equal 'sent', e.status
    assert_equal subject, e.subject
    assert_equal text, e.text_body
    assert_equal ["üser-#{tag}@example.com"], e.to
  end

  def test_a_send_without_an_idempotency_key_is_stored_without_one
    c = client
    res = c.send_email(to: 'nokey@example.com', subject: 'nokey', text: 'x', idempotency_key: false)
    assert_nil res.idempotency_key
    assert_operator res.id, :>, 0
    assert_nil c.emails.get(res.id).idempotency_key
  end
end

class E2EIdempotencyTest < E2ETestCase
  def test_idempotent_replay_and_conflict
    c = client
    msg = { to: 'idem@example.com', subject: 'idem', text: 'same', idempotency_key: "e2e-#{E2E.uid}" }
    first = c.send_email(**msg)
    refute_predicate first, :idempotent_replay?
    again = c.send_email(**msg)
    assert_equal first.id, again.id
    assert_predicate again, :idempotent_replay?
    assert_equal msg[:idempotency_key], again.idempotency_key

    err = assert_raises(Unsent::ConflictError) { c.send_email(**msg, text: 'different') }
    assert_equal 'idempotency_key_conflict', err.code
    assert_equal first.id, err.existing_email_id
    assert_equal 409, err.status
  end

  def test_generated_keys_do_not_deduplicate_across_calls
    c = client
    a = c.send_email(to: 'gen@example.com', subject: 'same', text: 'same')
    b = c.send_email(to: 'gen@example.com', subject: 'same', text: 'same')
    refute_equal a.id, b.id
    refute_equal a.idempotency_key, b.idempotency_key
  end

  def test_a_caller_key_deduplicates_across_clients
    key = "e2e-xclient-#{E2E.uid}"
    msg = { to: 'x@example.com', subject: 'cross', text: 'same', idempotency_key: key }
    a = client.send_email(**msg)
    b = client.send_email(**msg)
    assert_equal a.id, b.id
    assert_predicate b, :idempotent_replay?
  end

  def test_six_parallel_sends_with_one_key_create_exactly_one_email
    c = client
    tag = E2E.uid
    msg = { to: 'par@example.com', subject: "par #{tag}", text: 'x', idempotency_key: "e2e-par-#{tag}" }
    results = 6.times.map { Thread.new { c.send_email(**msg) } }.map(&:value)
    assert_equal 1, results.map(&:id).uniq.length, 'all six attempts must resolve to the same email'
    assert_equal 1, results.count { |r| !r.idempotent_replay? }, 'exactly one attempt created the email'
    assert_equal 1, c.emails.list(search: tag, limit: 200).total
  end

  def test_twenty_five_concurrent_signed_sends_all_pass_nonce_replay_protection
    skip 'server runs without signature verification' unless E2E.signed?

    c = client
    tag = E2E.uid
    results = 25.times.map do |i|
      Thread.new { c.send_email(to: 'burst@example.com', subject: "burst #{tag} #{i}", text: 'x') }
    end.map(&:value)
    assert_equal 25, results.map(&:id).uniq.length, 'a reused nonce would be rejected'
    assert_equal 25, c.emails.list(search: tag, limit: 200).total
  end
end

class E2EClockSkewTest < E2ETestCase
  # A client whose wall clock is off by +offset+ seconds while its monotonic clock stays real.
  class SkewedClock
    def initialize(offset)
      @offset = offset
      @real = Unsent::SystemClock.new
    end

    attr_accessor :offset

    def now = @real.now + offset
    def monotonic = @real.monotonic
    def sleep(seconds, cancel = nil) = @real.sleep(seconds, cancel)
  end

  def offset_of(client)
    client.instance_variable_get(:@http).send(:clock_offset)
  end

  def test_a_slow_local_clock_is_corrected_automatically
    skip 'server runs without signature verification' unless E2E.signed?

    clock = SkewedClock.new(-600)
    c = E2E.client(clock: clock)
    res = c.send_email(to: 'skew@example.com', subject: 'skew', text: 'x')
    assert_operator res.id, :>, 0
    assert_in_delta 600.0, offset_of(c), 30.0, 'the offset must be learned from /api/health'
    # No further correction is needed once the offset is stored.
    assert_operator c.send_email(to: 'skew@example.com', subject: 'skew2', text: 'x').id, :>, res.id
    assert_in_delta 600.0, offset_of(c), 30.0

    # The host clock is fixed: the stale offset must self-heal.
    clock.offset = 0
    assert_operator c.send_email(to: 'skew@example.com', subject: 'skew3', text: 'x').id, :>, res.id
    assert_in_delta 0.0, offset_of(c), 1.0
  end

  def test_a_fast_local_clock_is_corrected_too
    skip 'server runs without signature verification' unless E2E.signed?

    c = E2E.client(clock: SkewedClock.new(3 * 3600))
    assert_operator c.send_email(to: 'skew@example.com', subject: 'skew+', text: 'x').id, :>, 0
    # The stored offset is (server time - local time), so a clock 3 h ahead learns -10800 s.
    assert_in_delta(-3 * 3600.0, offset_of(c), 30.0)
  end
end

class E2ECredentialsTest < E2ETestCase
  SEND = { to: 'a@example.com', subject: 's', text: 't' }.freeze

  def test_wrong_credentials_produce_actionable_errors
    if E2E.signed?
      err = assert_raises(Unsent::AuthenticationError) do
        E2E.client(api_secret: 'wrong-secret', max_retries: 0).send_email(**SEND)
      end
      assert_equal 'invalid_signature', err.code
      assert_equal 401, err.status
      assert_match(/api_secret/, err.hint)
      refute_includes err.message, E2E::SECRET

      err = assert_raises(Unsent::AuthenticationError) do
        E2E.client(api_secret: nil, max_retries: 0).send_email(**SEND)
      end
      assert_includes %w[timestamp_skew missing_signature invalid_nonce], err.code
      assert_match(/signed requests/, err.hint)
    end

    bad_key = E2E.client(api_key: 'nope', max_retries: 0)
    err = assert_raises(Unsent::AuthenticationError) { bad_key.send_email(**SEND) }
    assert_equal 'invalid_api_key', err.code
    assert_match(/api_key/, err.hint)

    err = assert_raises(Unsent::AuthenticationError) { bad_key.status }
    assert_equal 401, err.status
    assert_match(/api_key/, err.hint)
    refute_includes err.message, E2E::SECRET
    refute_includes err.inspect, E2E::KEY
  end

  def test_no_secret_at_all_against_a_signing_server
    skip 'server runs without signature verification' unless E2E.signed?

    c = E2E.client(api_secret: nil, max_retries: 0)
    res = c.send_email(**SEND)
    assert_operator res.id, :>, 0
  rescue Unsent::AuthenticationError => e
    assert_match(/signed requests/, e.hint)
  end
end

class E2ERequestErrorsTest < E2ETestCase
  def test_an_unauthorized_sender_is_a_request_error_with_a_hint
    c = client
    err = assert_raises(Unsent::RequestError) do
      c.send_email(from: 'stranger@evil.test', to: 'a@example.com', subject: 's', text: 't')
    end
    assert_equal 'unauthorized_sender', err.code
    assert_equal 400, err.status
    refute_nil err.hint
    assert_match(/not an active provider/, err.hint)
  end

  def test_an_unknown_provider_id_is_also_unauthorized
    c = client
    err = assert_raises(Unsent::RequestError) do
      c.send_email(provider_id: 'does-not-exist', to: 'a@example.com', subject: 's', text: 't')
    end
    assert_equal 'unauthorized_sender', err.code
  end

  def test_an_unknown_email_is_not_found
    err = assert_raises(Unsent::NotFoundError) { client.emails.get(99_999_999) }
    assert_equal 404, err.status
  end

  def test_server_side_size_limits_surface_as_request_errors
    c = client
    err = assert_raises(Unsent::RequestError) do
      c.send_email(to: 'a@example.com', subject: 'big', text: 'x',
                   attachments: [{ filename: 'big.bin', content: SecureRandom.random_bytes(1_600_000).b }])
    end
    assert_equal 413, err.status
    assert_equal 'payload_too_large', err.code
    # ... and something comfortably inside the limit is accepted.
    ok = c.send_email(to: 'a@example.com', subject: 'biggish', text: 'x',
                      attachments: [{ filename: 'ok.bin', content: SecureRandom.random_bytes(1_000_000).b }])
    assert_operator ok.id, :>, 0
  end
end

class E2EPagingTest < E2ETestCase
  def test_list_filters_sorting_and_pagination
    c = client
    tag = E2E.uid
    ids = 7.times.map do |i|
      c.send_email(to: "l#{i}-#{tag}@example.com", subject: "list #{tag} #{i}", text: 'x').id
    end
    page = c.emails.list(search: tag, limit: 3, sort: 'created_at_asc')
    assert_equal 7, page.total
    assert_predicate page, :has_more?
    assert_equal ids.first(3), page.emails.map(&:id)
    assert_equal [3, 0], [page.limit, page.offset]

    last = c.emails.list(search: tag, limit: 3, offset: 6, sort: 'created_at_asc')
    assert_equal ids[6..], last.emails.map(&:id)
    refute_predicate last, :has_more?

    desc = c.emails.list(search: tag, sort: 'created_at_desc')
    assert_equal ids.reverse, desc.emails.map(&:id)

    today = Time.now.utc.strftime('%Y-%m-%d')
    assert_equal 7, c.emails.list(search: tag, from: today, to: today).total
    assert_equal 0, c.emails.list(search: tag, from: '2999-01-01').total
    assert_equal 0, c.emails.list(search: tag, to: '2000-01-01').total
    assert_empty c.emails.list(search: "nomatch-#{tag}").emails

    ids.each { |id| wait_sent(id) }
    assert_equal 7, c.emails.list(search: tag, status: 'sent').total
    assert_equal 0, c.emails.list(search: tag, status: 'failed').total
  end

  def test_each_walks_every_page_in_ascending_unique_order
    c = client
    tag = E2E.uid
    ids = 5.times.map { |i| c.send_email(to: "it-#{tag}@example.com", subject: "iter #{tag} #{i}", text: 'x').id }
    walked = c.emails.each(search: tag, limit: 2).map(&:id)
    assert_equal ids, walked
    assert_equal walked.first(3), c.emails.each(search: tag).first(3).map(&:id)

    everything = c.emails.each(limit: 7).map(&:id)
    assert_operator everything.length, :>, 1
    assert_equal everything.sort, everything
    assert_equal everything.uniq.length, everything.length
  end
end

class E2EWaitTest < E2ETestCase
  def test_wait_returns_when_the_email_is_delivered
    c = client
    res = c.send_email(to: 'wait@example.com', subject: 'wait', text: 'x')
    e = c.emails.wait(res.id, timeout: E2E::TIMEOUT, interval: 0.2)
    assert_equal 'sent', e.status
    assert_predicate e, :final?

    # An already-final email returns after a single request, without sleeping.
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    assert_equal 'sent', c.emails.wait(res.id).status
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 2
  end

  def test_wait_can_be_aborted_and_an_unknown_id_fails_fast
    c = client
    res = c.send_email(to: 'cancel@example.com', subject: 'cancel', text: 'x')
    token = Unsent::CancelToken.new
    token.cancel!
    err = assert_raises(Unsent::ConnectionError) { c.emails.wait(res.id, cancel: token) }
    assert_equal 'aborted', err.code
    assert_raises(Unsent::NotFoundError) { c.emails.wait(99_999_999, timeout: 2) }
  end
end

# A tiny proxy that forwards requests to the worker but destroys the connection before replying to the first
# `drop_first` /api/send requests: the worker processed them, the SDK never hears back. The SDK must retry with
# the same idempotency key, so exactly one email exists afterwards.
class LossyProxy
  attr_reader :url, :sends

  def initialize(upstream, drop_first: 1)
    uri = URI.parse(upstream)
    @upstream = [uri.host, uri.port]
    @drop_first = drop_first
    @sends = 0
    @lock = Mutex.new
    @server = TCPServer.new('127.0.0.1', 0)
    @url = "http://127.0.0.1:#{@server.addr[1]}"
    @running = true
    @threads = []
    @acceptor = Thread.new { accept_loop }
  end

  def close
    @running = false
    @server.close unless @server.closed?
    @acceptor.kill
    @threads.each(&:kill)
  end

  private

  def accept_loop
    while @running
      sock = @server.accept
      @threads << Thread.new(sock) { |s| handle(s) }
    end
  rescue IOError, Errno::EBADF
    nil
  end

  def handle(sock)
    head = +''
    head << sock.gets("\r\n").to_s while !head.end_with?("\r\n\r\n") && !sock.eof?
    return sock.close if head.empty?

    length = head[/^Content-Length:\s*(\d+)/i, 1].to_i
    body = length.positive? ? sock.read(length) : ''
    request_line = head.lines.first.to_s.chomp
    drop = false
    if request_line.include?(' /api/send ')
      @lock.synchronize do
        @sends += 1
        drop = (@sends <= @drop_first)
      end
    end

    upstream = TCPSocket.new(*@upstream)
    upstream.write(head + body)
    response = +''
    begin
      loop { response << upstream.readpartial(65_536) }
    rescue EOFError, IOError, SystemCallError
      nil
    end
    upstream.close
    sock.close and return if drop

    sock.write(response)
  rescue IOError, SystemCallError
    nil
  ensure
    begin
      sock.close unless sock.closed?
    rescue IOError
      nil
    end
  end
end

class E2ELostResponseTest < E2ETestCase
  def test_a_lost_response_is_retried_with_the_same_key_and_creates_one_email
    skip 'server runs without signature verification' unless E2E.signed?

    proxy = LossyProxy.new(E2E::ENV_URL, drop_first: 1)
    tag = E2E.uid
    c = Unsent::Client.new(base_url: proxy.url, api_key: E2E::KEY, api_secret: E2E::SECRET, env: {},
                           default_from: E2E::FROM, timeout: 30, max_retries: 3)
    res = c.send_email(to: "lost-#{tag}@example.com", subject: "lost #{tag}", text: 'body')
    assert_predicate res, :idempotent_replay?, 'the retry must hit the email the lost attempt created'
    assert_equal 2, proxy.sends, 'one lost attempt plus one retry'
    direct = E2E.client
    listed = direct.emails.list(search: tag, limit: 200)
    assert_equal 1, listed.total
    assert_equal res.id, listed.emails[0].id
    assert_equal 'sent', direct.emails.wait(res.id, timeout: E2E::TIMEOUT).status
  ensure
    proxy&.close
  end

  def test_without_a_key_a_lost_response_is_not_retried
    skip 'server runs without signature verification' unless E2E.signed?

    proxy = LossyProxy.new(E2E::ENV_URL, drop_first: 1)
    tag = E2E.uid
    c = Unsent::Client.new(base_url: proxy.url, api_key: E2E::KEY, api_secret: E2E::SECRET, env: {},
                           default_from: E2E::FROM, timeout: 30, max_retries: 3)
    err = assert_raises(Unsent::ConnectionError) do
      c.send_email(to: "nokey-#{tag}@example.com", subject: "nokey #{tag}", text: 'b', idempotency_key: false)
    end
    assert_equal 'connection_error', err.code
    assert_equal 1, proxy.sends, 'a retry could have duplicated the email, so it must not happen'
    # It *was* delivered — which is exactly why retrying without a key is unsafe.
    assert_equal 1, E2E.client.emails.list(search: tag, limit: 200).total
  ensure
    proxy&.close
  end
end
