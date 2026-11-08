# frozen_string_literal: true

require_relative '../test_helper'

class RetryTest < UnsentTestCase
  def test_retries_5xx_with_the_same_idempotency_key_but_a_fresh_nonce_and_signature
    c, t = setup_client { |r| r.n < 3 ? api_error(500, 'internal_error', 'Internal server error') : accepted(5) }
    res = c.send_email(**MSG)
    assert_equal 5, res.id
    assert_equal 3, t.calls.length
    assert_equal 1, t.calls.map { |r| r.json['idempotency_key'] }.uniq.length
    assert_equal 3, t.calls.map { |r| r.header('X-Nonce') }.uniq.length
    used = Set.new
    t.calls.each { |r| assert_equal [true, nil], verify_signed(r, API_SECRET, used) }
  end

  def test_each_retried_send_carries_a_fresh_timestamp
    clock = FakeClock.new
    c, t = setup_client(clock: clock) { |r| r.n < 3 ? api_error(503, 'x') : accepted }
    c.send_email(**MSG)
    stamps = t.calls.map { |r| r.header('X-Timestamp').to_i }
    assert_equal stamps.sort, stamps
    assert_operator stamps.last, :>, stamps.first
  end

  def test_retries_408_425_429_502_503_504_honoring_retry_after
    [408, 425, 429, 502, 503, 504].each do |status|
      c, t, clock = setup_client { |r| r.n == 1 ? api_error(status, 'x', 'e', nil, 'Retry-After' => '2') : accepted }
      c.send_email(**MSG)
      assert_equal 2, t.calls.length, status.to_s
      assert_in_delta 2.0, clock.slept[0], 0.001, "Retry-After must win over the 0.25-0.5 s backoff (#{status})"
    end
  end

  def test_backoff_is_exponential_with_jitter_and_capped_at_eight_seconds
    c, _t, clock = setup_client(max_retries: 10) { api_error(503, 'x') }
    assert_raises(Unsent::ServerError) { c.send_email(**MSG) }
    assert_equal 10, clock.slept.length
    clock.slept.each_with_index do |delay, attempt|
      exp = [8.0, 0.5 * (2**attempt)].min
      assert_operator delay, :>=, (exp / 2) - 1e-9, "attempt #{attempt}"
      assert_operator delay, :<=, exp + 1e-9, "attempt #{attempt}"
    end
    assert_operator clock.slept.last, :<=, 8.0
  end

  def test_backoff_has_jitter
    delays = 40.times.map do
      c, _t, clock = setup_client(max_retries: 1) { api_error(503, 'x') }
      assert_raises(Unsent::ServerError) { c.send_email(**MSG) }
      clock.slept[0]
    end
    assert_operator delays.uniq.length, :>, 10
  end

  def test_retry_after_is_capped_at_sixty_seconds_and_accepts_http_dates
    c, _t, clock = setup_client { |r| r.n == 1 ? api_error(429, 'rate_limited', 'slow', nil, 'Retry-After' => '99999999999999999999999') : accepted }
    c.send_email(**MSG)
    assert_in_delta 60.0, clock.slept[0], 0.001

    clock2 = FakeClock.new
    c2, = setup_client(clock: clock2) { |r| r.n == 1 ? api_error(503, 'x', 'e', nil, 'Retry-After' => Time.at(clock2.now + 5).httpdate) : accepted }
    c2.send_email(**MSG)
    assert_in_delta 5.0, clock2.slept[0], 1.1
  end

  def test_invalid_retry_after_values_are_ignored
    ['soon', '-5', '', 'NaN', '1e999', "5\r\nX: y", 'x' * 5000, 'Mon, 99 Foo 2026 25:61:61 GMT'].each do |value|
      c, _t, clock = setup_client(max_retries: 1) { |r| r.n == 1 ? api_error(503, 'x', 'e', nil, 'Retry-After' => value) : accepted }
      c.send_email(**MSG)
      assert_operator clock.slept[0], :<=, 0.5 + 1e-9, value.inspect
    end
  end

  def test_retries_network_errors_of_every_kind
    errors = [Errno::ECONNRESET.new, Errno::ECONNREFUSED.new, SocketError.new('getaddrinfo: nodename nor servname'),
              EOFError.new, IOError.new('closed stream'), OpenSSL::SSL::SSLError.new('handshake'), Net::ReadTimeout.new,
              Net::OpenTimeout.new, Timeout::Error.new('execution expired'), Errno::EPIPE.new]
    errors.each do |error|
      c, t = setup_client { |r| r.n < 3 ? raise(error.dup) : accepted }
      assert_equal 1, c.send_email(**MSG).id, error.class.name
      assert_equal 3, t.calls.length, error.class.name
    end
  end

  def test_gives_up_after_max_retries_and_surfaces_the_last_error
    c, t = setup_client(max_retries: 2) { api_error(503, 'x', 'Unavailable') }
    err = assert_raises(Unsent::ServerError) { c.send_email(**MSG) }
    assert_equal 503, err.status
    assert_equal 3, t.calls.length
  end

  def test_max_retries_zero_at_client_or_call_level_disables_retries
    a, ta = setup_client(max_retries: 0) { api_error(500, 'internal_error') }
    assert_raises(Unsent::ServerError) { a.send_email(**MSG) }
    assert_equal 1, ta.calls.length
    b, tb = setup_client { api_error(500, 'internal_error') }
    assert_raises(Unsent::ServerError) { b.send_email(**MSG, max_retries: 0) }
    assert_equal 1, tb.calls.length
    d, td = setup_client(max_retries: 0) { |r| r.n < 3 ? api_error(500, 'internal_error') : accepted }
    d.send_email(**MSG, max_retries: 5)
    assert_equal 3, td.calls.length
  end

  NO_RETRY = [
    [400, 'validation_error', Unsent::RequestError], [400, 'unauthorized_sender', Unsent::RequestError],
    [401, 'invalid_api_key', Unsent::AuthenticationError], [401, 'invalid_signature', Unsent::AuthenticationError],
    [401, 'nonce_reused', Unsent::AuthenticationError], [403, 'forbidden', Unsent::PermissionError],
    [404, 'not_found', Unsent::NotFoundError], [409, 'idempotency_key_conflict', Unsent::ConflictError],
    [413, 'payload_too_large', Unsent::RequestError], [422, 'x', Unsent::APIError],
    [500, 'server_misconfigured', Unsent::ServerError], [501, 'x', Unsent::ServerError], [505, 'x', Unsent::ServerError]
  ].freeze

  NO_RETRY.each do |status, code, klass|
    define_method("test_does_not_retry_#{status}_#{code}") do
      c, t = setup_client { api_error(status, code, 'nope') }
      assert_raises(klass) { c.send_email(**MSG) }
      assert_equal 1, t.calls.length
    end
  end

  def test_never_retries_a_send_with_idempotency_key_false
    net, tn = setup_client { raise SocketError, 'down' }
    assert_raises(Unsent::ConnectionError) { net.send_email(**MSG, idempotency_key: false) }
    assert_equal 1, tn.calls.length
    srv, ts = setup_client { api_error(500, 'internal_error') }
    assert_raises(Unsent::ServerError) { srv.send_email(**MSG, idempotency_key: false) }
    assert_equal 1, ts.calls.length
    slow, tt = setup_client(timeout: 0.05) { sleep }
    assert_raises(Unsent::TimeoutError) { slow.send_email(**MSG, idempotency_key: false) }
    assert_equal 1, tt.calls.length
  end

  def test_a_retried_send_whose_first_attempt_landed_resolves_as_an_idempotent_replay
    c, t = setup_client do |r|
      r.n == 1 ? api_error(502, 'x', 'Bad gateway') : json({ success: true, id: 4, status: 'queued', idempotent_replay: true, message: 'm', targetProvider: 'p' }, 200, 'Idempotent-Replayed' => 'true')
    end
    res = c.send_email(**MSG)
    assert_equal 4, res.id
    assert_predicate res, :idempotent_replay?
    assert_equal 2, t.calls.length
  end

  def test_get_requests_are_retried_too
    c, t = setup_client { |r| r.n < 3 ? api_error(503, 'x') : json({ queued: 1, sending: 0, sent: 0, failed: 0 }) }
    assert_equal 1, c.status.queued
    assert_equal 3, t.calls.length
  end

  def test_an_oversized_response_is_not_retried
    c, t = setup_client { raw(200, 'x', 'Content-Length' => (33 * 1024 * 1024).to_s) }
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'response_too_large', err.code
    assert_equal 1, t.calls.length
  end
end

class ClockSkewTest < UnsentTestCase
  # A server whose clock is +offset+ seconds ahead of the client's.
  def skewed_server(clock, ahead:, date_header: true)
    lambda do |req|
      server_now = clock.now - clock.skew + ahead.call
      if req.path == '/api/health'
        next json({ status: 'ok', timestamp: (server_now * 1000).to_i })
      end
      ts = req.header('X-Timestamp').to_i
      if (server_now - ts).abs > 180
        headers = date_header ? { 'Date' => Time.at(server_now).httpdate } : {}
        next api_error(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range', headers)
      end
      accepted(8)
    end
  end

  def test_learns_the_server_clock_from_the_date_header_and_retries_once_correctly_signed
    clock = FakeClock.new
    c, t = setup_client(clock: clock, &skewed_server(clock, ahead: -> { 600 }))
    assert_equal 8, c.send_email(**MSG).id
    assert_equal 2, t.calls.length
    assert_empty clock.slept, 'the corrected retry must not wait or consume a retry'
    assert_operator t.calls[1].header('X-Timestamp').to_i - t.calls[0].header('X-Timestamp').to_i, :>=, 590
    c.send_email(**MSG) # the offset is remembered
    assert_equal 3, t.calls.length
  end

  def test_works_when_the_local_clock_is_fast
    clock = FakeClock.new
    c, t = setup_client(clock: clock, &skewed_server(clock, ahead: -> { -900 }))
    assert_equal 8, c.send_email(**MSG).id
    assert_equal 2, t.calls.length
  end

  def test_falls_back_to_the_health_probe_when_the_response_has_no_date_header
    clock = FakeClock.new
    c, t = setup_client(clock: clock, &skewed_server(clock, ahead: -> { 600 }, date_header: false))
    assert_equal 8, c.send_email(**MSG).id
    assert_equal %w[/api/send /api/health /api/send], t.paths
    assert_nil t.calls[1].header('X-API-Key'), 'the health probe carries no credentials'
    assert_nil t.calls[1].header('X-Signature')
  end

  def test_drops_a_stale_offset_when_the_host_clock_has_since_been_fixed
    clock = FakeClock.new
    ahead = 600
    c, t = setup_client(clock: clock, &skewed_server(clock, ahead: -> { ahead }))
    c.send_email(**MSG) # learns +600
    ahead = 0 # operator fixes the clock
    c.send_email(**MSG) # stale offset now wrong; must self-heal
    assert_equal 4, t.paths.count('/api/send')
    c.send_email(**MSG)
    assert_equal 5, t.paths.count('/api/send')
  end

  def test_gives_up_cleanly_when_the_health_probe_is_unreachable
    c, t = setup_client do |r|
      raise SocketError, 'down' if r.path == '/api/health'

      api_error(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range')
    end
    err = assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_equal 'timestamp_skew', err.code
    assert_equal 1, t.paths.count('/api/send')
  end

  def test_gives_up_when_the_health_probe_returns_garbage
    ['{}', '[]', '"x"', 'null', '{"timestamp":"soon"}', '{"timestamp":true}', 'not json'].each do |body|
      c, t = setup_client { |r| r.path == '/api/health' ? raw(200, body) : api_error(401, 'timestamp_skew', 'Unauthorized') }
      assert_raises(Unsent::AuthenticationError, body) { c.send_email(**MSG) }
      assert_equal 1, t.paths.count('/api/send'), body
    end
  end

  def test_does_not_loop_when_the_skew_persists
    c, t = setup_client { api_error(401, 'timestamp_skew', 'Unauthorized', 'bad', 'Date' => Time.now.gmtime.+(3600).httpdate) }
    err = assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_equal 'timestamp_skew', err.code
    assert_equal 2, t.calls.length
  end

  def test_ignores_small_skews_it_cannot_be_the_cause_of
    c, t = setup_client { api_error(401, 'timestamp_skew', 'Unauthorized', 'bad', 'Date' => Time.now.httpdate) }
    assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_equal 1, t.calls.length
  end

  def test_no_correction_without_an_api_secret
    t = MockTransport.new { api_error(401, 'timestamp_skew', 'Unauthorized', 'bad', 'Date' => (Time.now + 3600).httpdate) }
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {}, clock: FakeClock.new)
    assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_equal 1, t.calls.length
  end

  def test_the_offset_is_shared_safely_between_threads
    clock = FakeClock.new
    c, t = setup_client(clock: clock, &skewed_server(clock, ahead: -> { 600 }))
    threads = 8.times.map { Thread.new { c.send_email(**MSG).id } }
    assert_equal [8] * 8, threads.map(&:value)
    assert_operator t.calls.length, :>=, 9
  end
end

class TimeoutAndAbortTest < UnsentTestCase
  def test_times_out_a_hung_request_and_retries_it
    killed = Queue.new
    c, t = setup_client(timeout: 0.05) do |r|
      if r.n == 1
        begin
          sleep
        ensure
          killed << :killed
        end
      end
      accepted
    end
    assert_equal 1, c.send_email(**MSG).id
    assert_equal 2, t.calls.length
    assert_equal :killed, killed.pop(true), 'the hung attempt must be torn down'
  end

  def test_surfaces_timeout_error_when_every_attempt_hangs
    c, t = setup_client(timeout: 0.03, max_retries: 1) { sleep }
    err = assert_raises(Unsent::TimeoutError) { c.send_email(**MSG) }
    assert_kind_of Unsent::ConnectionError, err
    assert_equal 'timeout', err.code
    assert_equal 2, t.calls.length
    assert_match(/timed out after/, err.message)
  end

  def test_honors_a_per_call_timeout
    c, = setup_client(max_retries: 0) { sleep }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    assert_raises(Unsent::TimeoutError) { c.send_email(**MSG, timeout: 0.05) }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 1.0
  end

  def test_the_timeout_covers_the_whole_attempt_not_just_idle_time
    c, = setup_client(max_retries: 0, timeout: 0.1) do
      loop { sleep 0.01 } # a slow-drip server that never goes idle for long
    end
    assert_raises(Unsent::TimeoutError) { c.status }
  end

  def test_abort_via_cancel_token_stops_immediately_without_retrying
    token = Unsent::CancelToken.new
    c, t = setup_client { sleep }
    Thread.new { sleep 0.05; token.cancel! }
    err = assert_raises(Unsent::ConnectionError) { c.send_email(**MSG, cancel: token) }
    assert_equal 'aborted', err.code
    refute_kind_of Unsent::TimeoutError, err
    assert_equal 1, t.calls.length
  end

  def test_abort_during_backoff_stops_waiting
    token = Unsent::CancelToken.new
    t = MockTransport.new { api_error(500, 'internal_error') }
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {}) # real clock: real backoff sleeps
    Thread.new { sleep 0.05; token.cancel! }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    err = assert_raises(Unsent::ConnectionError) { c.send_email(**MSG, cancel: token) }
    assert_equal 'aborted', err.code
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.25
    assert_equal 1, t.calls.length
  end

  def test_an_already_cancelled_token_never_touches_the_network
    token = Unsent::CancelToken.new.cancel!
    c, t = setup_client { accepted }
    err = assert_raises(Unsent::ConnectionError) { c.send_email(**MSG, cancel: token) }
    assert_equal 'aborted', err.code
    assert_no_requests t
    assert_equal 'aborted', assert_raises(Unsent::ConnectionError) { c.status(cancel: token) }.code
  end

  def test_cancel_token_basics
    token = Unsent::CancelToken.new
    refute_predicate token, :cancelled?
    assert_equal false, token.wait(0.01)
    token.cancel!
    token.cancel!
    assert_predicate token, :cancelled?
    assert_predicate token, :canceled?
    assert_equal true, token.wait(5)
    fired = 0
    token.on_cancel { fired += 1 }
    assert_equal 1, fired
  end

  def test_a_transport_that_raises_a_non_standard_error_still_does_not_leak_threads
    before = Thread.list.length
    c, = setup_client(max_retries: 0) { raise 'boom' }
    assert_raises(Unsent::ConnectionError) { c.send_email(**MSG) }
    sleep 0.05
    assert_operator Thread.list.length, :<=, before
  end
end

class ErrorMappingTest < UnsentTestCase
  def test_exposes_status_code_reason_body_and_a_helpful_hint
    c, = setup_client { api_error(401, 'invalid_signature', 'Unauthorized', 'Invalid signature (request headers or body may have been tampered with)') }
    err = assert_raises(Unsent::AuthenticationError) { c.send_email(**MSG) }
    assert_kind_of Unsent::APIError, err
    assert_kind_of Unsent::Error, err
    assert_equal 401, err.status
    assert_equal 'invalid_signature', err.code
    assert_match(/tampered/, err.reason)
    assert_match(/api_secret/, err.hint)
    assert_match(/Unauthorized.*tampered.*api_secret/m, err.message)
    assert_equal({ 'error' => 'Unauthorized', 'code' => 'invalid_signature', 'reason' => err.reason }, err.body)
  end

  def test_hints_for_every_documented_code
    {
      'invalid_api_key' => /api_key matches the API_KEY/, 'unauthorized' => /api_key matches the API_KEY/,
      'invalid_signature' => /api_secret matches the API_SECRET.*no extra whitespace/, 'missing_signature' => /requires signed requests.*api_secret/,
      'unauthorized_sender' => /not an active provider.*omit "from"/, 'forbidden' => /admin dashboard session/,
      'timestamp_skew' => /clock differs.*3 minutes.*NTP/
    }.each do |code, pattern|
      c, = setup_client(max_retries: 0) { api_error(code == 'forbidden' ? 403 : 401, code, 'E') }
      err = assert_raises(Unsent::APIError, code) { c.status }
      assert_match pattern, err.hint, code
      assert_includes err.message, "(#{err.hint})"
    end
  end

  def test_points_at_api_secret_when_a_signing_required_server_rejects_an_unsigned_request
    %w[timestamp_skew invalid_nonce].each do |code|
      t = MockTransport.new { api_error(401, code, 'Unauthorized', 'Invalid or missing X-Timestamp header') }
      err = assert_raises(Unsent::AuthenticationError) do
        Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {}).send_email(**MSG)
      end
      assert_match(/requires signed requests/, err.hint, code)
    end
  end

  def test_surfaces_the_conflicting_email_id_on_idempotency_conflicts
    c, = setup_client { json({ error: 'Idempotency key was already used for a different email', code: 'idempotency_key_conflict', id: 77 }, 409) }
    err = assert_raises(Unsent::ConflictError) { c.send_email(**MSG, idempotency_key: 'k') }
    assert_equal 77, err.existing_email_id
    assert_equal 'idempotency_key_conflict', err.code
  end

  def test_existing_email_id_ignores_non_integer_ids
    c, = setup_client { json({ error: 'x', code: 'c', id: 'seven' }, 409) }
    assert_nil assert_raises(Unsent::ConflictError) { c.status }.existing_email_id
  end

  def test_parses_retry_after_on_429
    c, = setup_client(max_retries: 0) { api_error(429, 'rate_limited', 'slow down', nil, 'Retry-After' => '7') }
    err = assert_raises(Unsent::RateLimitError) { c.send_email(**MSG) }
    assert_equal 7, err.retry_after
  end

  def test_code_falls_back_to_internal_error_for_5xx_and_http_status_otherwise
    c, = setup_client(max_retries: 0) { raw(502, '<html>Bad gateway</html>') }
    err = assert_raises(Unsent::ServerError) { c.send_email(**MSG) }
    assert_equal 502, err.status
    assert_equal 'internal_error', err.code
    assert_equal '<html>Bad gateway</html>', err.message
    assert_equal '<html>Bad gateway</html>', err.body

    c2, = setup_client { json({ error: 'teapot' }, 418) }
    err = assert_raises(Unsent::APIError) { c2.status }
    assert_equal 'http_418', err.code
    assert_instance_of Unsent::APIError, err
  end

  def test_handles_an_empty_error_body
    c, = setup_client { raw(404, '') }
    err = assert_raises(Unsent::NotFoundError) { c.status }
    assert_equal 'http_404', err.code
    assert_equal 'HTTP 404', err.message
  end

  def test_a_200_with_a_non_json_body_is_flagged
    c, = setup_client { raw(200, '<!doctype html>hi') }
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'invalid_response', err.code
    assert_match(/base_url/, err.message)
    refute_kind_of Unsent::APIError, err
  end

  def test_connection_failures_name_the_host_and_root_cause_and_keep_the_cause
    c, = setup_client(max_retries: 0) { raise SocketError, 'getaddrinfo: Name or service not known (unsent.test)' }
    err = assert_raises(Unsent::ConnectionError) { c.send_email(**MSG) }
    assert_match(/unsent\.test.*Name or service/m, err.message)
    assert_kind_of SocketError, err.cause
    assert_equal 'connection_error', err.code
  end

  def test_message_deduplicates_a_reason_the_error_already_contains
    c, = setup_client { api_error(400, 'validation_error', 'Bad: field x', 'field x') }
    assert_equal 'Bad: field x', assert_raises(Unsent::RequestError) { c.status }.message
  end

  def test_never_follows_redirects
    seen = nil
    t = MockTransport.new do |r|
      seen = r
      raw(308, '', 'Location' => 'https://elsewhere.test/api/status')
    end
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {}, clock: FakeClock.new)
    err = assert_raises(Unsent::Error) { c.status }
    assert_equal 'unexpected_redirect', err.code
    refute_kind_of Unsent::APIError, err
    assert_match(%r{redirected to https://elsewhere\.test}, err.message)
    assert_equal 1, t.calls.length, 'redirects are not retried or followed'
    assert_equal 'unsent.test', seen.url.host
    [301, 302, 303, 307].each do |status|
      t2 = MockTransport.new { raw(status, '', 'location' => '/x') }
      c2 = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t2, env: {}, clock: FakeClock.new)
      assert_equal 'unexpected_redirect', assert_raises(Unsent::Error) { c2.send_email(**MSG) }.code
      assert_equal 1, t2.calls.length
    end
  end

  def test_error_to_h_has_the_stable_fields
    c, = setup_client(max_retries: 0) { api_error(409, 'idempotency_key_conflict', 'dup') }
    h = assert_raises(Unsent::ConflictError) { c.status }.to_h
    assert_equal({ class: 'Unsent::ConflictError', code: 'idempotency_key_conflict', message: 'dup', status: 409 }, h)
  end
end
