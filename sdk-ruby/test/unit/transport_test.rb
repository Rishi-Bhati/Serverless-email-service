# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/tiny_server'

# The real Net::HTTP transport against a scripted local peer.
class TransportTest < UnsentTestCase
  def with_server(&handler)
    server = TinyServer.new(&handler)
    yield server
  ensure
    server&.stop
  end

  def real_client(server, **opts)
    Unsent::Client.new(base_url: server.base_url, api_key: API_KEY, api_secret: API_SECRET, env: {}, **opts)
  end

  def test_round_trips_a_signed_send_over_a_real_socket
    with_server do |s|
      s.instance_variable_set(:@handler, lambda do |_l, _h, _b, _sock|
        TinyServer.http(202, JSON.generate(id: 7, status: 'queued', message: 'ok', targetProvider: 'T'), 'Content-Type' => 'application/json')
      end)
      res = real_client(s).send_email(to: 'a@b.co', subject: 'Grüße', text: 'héllo')
      assert_equal 7, res.id
      req = s.requests[0]
      assert_equal 'POST /api/send HTTP/1.1', req[:line]
      assert_equal API_KEY, req[:headers]['x-api-key']
      assert_equal 'application/json', req[:headers]['content-type']
      assert_equal "unsent-sdk-ruby/#{Unsent::VERSION}", req[:headers]['user-agent']
      assert_equal 'identity', req[:headers]['accept-encoding']
      rec = UnsentTest::Recorded.new(request: Unsent::Transport::Request.new(
        method: 'POST', url: 'x', headers: req[:headers].transform_keys { |k| k.split('-').map(&:capitalize).join('-') }.merge('X-API-Key' => API_KEY),
        body: req[:body].dup.force_encoding('UTF-8')
      ), n: 1)
      assert_equal [true, nil], verify_signed(rec)
      assert_equal 'Grüße', JSON.parse(req[:body].force_encoding('UTF-8'))['subject']
    end
  end

  def test_gets_use_query_strings_and_no_body
    with_server do |s|
      s.instance_variable_set(:@handler, ->(*_) { TinyServer.http(200, '{"emails":[],"total":0}') })
      real_client(s).emails.list(limit: 5, search: 'a b&c=d')
      assert_equal 'GET /api/emails?limit=5&q=a+b%26c%3Dd HTTP/1.1', s.requests[0][:line]
      assert_nil s.requests[0][:headers]['content-type']
    end
  end

  def test_handles_chunked_responses_and_error_statuses
    with_server do |s|
      s.instance_variable_set(:@handler, lambda do |*_|
        "HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" \
          "e\r\n{\"error\":\"nop\"\r\n2\r\n}\n\r\n0\r\n\r\n"
      end)
      err = assert_raises(Unsent::NotFoundError) { real_client(s).emails.get(5) }
      assert_equal 'nop', err.message
    end
  end

  def test_connection_refused_is_a_retryable_connection_error_naming_the_host
    server = TCPServer.new('127.0.0.1', 0)
    port = server.addr[1]
    server.close
    c = Unsent::Client.new(base_url: "http://127.0.0.1:#{port}", api_key: API_KEY, env: {}, max_retries: 0)
    err = assert_raises(Unsent::ConnectionError) { c.status }
    assert_match(/Could not reach 127\.0\.0\.1/, err.message)
    refute_kind_of Unsent::TimeoutError, err
  end

  def test_a_server_that_hangs_triggers_the_timeout
    with_server do |s|
      s.instance_variable_set(:@handler, ->(*_) { sleep 5 })
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      assert_raises(Unsent::TimeoutError) { real_client(s, timeout: 0.2, max_retries: 0).status }
      assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 2
    end
  end

  def test_a_connection_dropped_mid_response_is_a_connection_error
    with_server do |s|
      s.instance_variable_set(:@handler, ->(*_) { "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"a\"" })
      assert_raises(Unsent::ConnectionError) { real_client(s, max_retries: 0).status }
    end
  end

  def test_transport_request_inspect_hides_the_api_key
    req = Unsent::Transport::Request.new(method: 'GET', url: 'https://x.test/a', headers: { 'X-API-Key' => 'SECRET-KEY-123' }, body: nil)
    refute_includes req.inspect, 'SECRET-KEY-123'
    refute_includes req.to_s, 'SECRET-KEY-123'
    assert_equal 'SECRET-KEY-123', req.header('x-api-key')
  end

  def test_custom_transports_may_return_hashes_or_duck_typed_objects
    duck = Struct.new(:status, :headers, :body)
    [->(_r) { { status: 200, headers: { 'X-A' => ['b', 'c'] }, body: '{"queued":1}' } },
     ->(_r) { duck.new(200, {}, '{"queued":1}') },
     ->(_r) { Unsent::Transport::Response.new(status: 200, body: '{"queued":1}') }].each do |tr|
      c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: tr, env: {})
      assert_equal 1, c.status.queued
    end
  end

  def test_unusable_transport_responses_become_invalid_response_errors
    [nil, 5, 'x', [], { status: 'ok' }, { status: 99, body: '' }, { status: 200, body: 5 }, { status: 700 }, Object.new].each do |junk|
      c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: ->(_r) { junk }, env: {}, max_retries: 0)
      err = assert_raises(Unsent::Error, junk.inspect) { c.status }
      assert_equal 'invalid_response', err.code
    end
  end
end
