# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/junk'
require_relative '../support/tiny_server'

# Thousands of seeded-random hostile inputs into every public method. The only acceptable outcomes are a
# normal result or one of the SDK's own Unsent::Error subclasses: never NoMethodError, TypeError, ArgumentError,
# JSON errors, a hang, or anything else.
class FuzzTest < UnsentTestCase
  SEED = Integer(ENV.fetch('UNSENT_FUZZ_SEED', '20260101'))
  ITERATIONS = Integer(ENV.fetch('UNSENT_FUZZ_ITERATIONS', '2500'))

  def ok_handler
    lambda do |r|
      case r.path
      when '/api/send' then accepted(3)
      when '/api/status' then json(queued: 1, sending: 0, sent: 2, failed: 0)
      when '/api/health' then json(status: 'ok', runtime: 'x', d1: 'y', timestamp: 1_780_000_000_000)
      when '/api/emails' then json(emails: [], total: 0, limit: 100, offset: 0)
      else json(email: { id: 1, status: 'sent', to: ['a@b.co'], attempts: 1 })
      end
    end
  end

  def guard(what)
    result = Timeout.timeout(20) { yield }
    result
  rescue Unsent::Error
    nil
  rescue Timeout::Error
    flunk "hang in #{what}"
  rescue StandardError, NotImplementedError => e
    flunk "#{what} leaked #{e.class}: #{e.message[0, 200]}\n#{e.backtrace.first(6).join("\n")}"
  end

  def fuzz_client
    setup_client(&ok_handler).first
  end

  def test_send_email_with_junk_options
    junk = Junk.new(SEED)
    client = fuzz_client
    ITERATIONS.times do |i|
      opts = junk.send_options
      guard("send_email ##{i} #{Unsent::Util.snippet(opts.keys.inspect, 100)}") { client.send_email(opts) }
    end
  end

  def test_send_email_with_totally_random_arguments
    junk = Junk.new(SEED + 1)
    client = fuzz_client
    ITERATIONS.times do |i|
      case junk.int(5)
      when 0 then guard("send positional ##{i}") { client.send_email(junk.value) }
      when 1 then guard("send hash ##{i}") { client.send_email(junk.options(Unsent::Emails::SEND_KEYS)) }
      when 2 then guard("send many ##{i}") { client.send_email(*Array.new(junk.int(4)) { junk.value }) }
      when 3 then guard("send kw ##{i}") { client.emails.deliver(**junk.options(Unsent::Emails::SEND_KEYS)) }
      else guard("send mixed ##{i}") { client.send_email(junk.value, **junk.options(Unsent::Emails::SEND_KEYS)) }
      end
    end
  end

  def test_read_methods_with_junk_arguments
    junk = Junk.new(SEED + 2)
    client = fuzz_client
    ITERATIONS.times do |i|
      args = Array.new(junk.int(3)) { junk.value }
      kw = junk.options(Unsent::Emails::LIST_KEYS + %i[interval])
      guard("get ##{i}") { client.emails.get(*args, **kw.slice(*Unsent::Emails::REQUEST_KEYS)) }
      guard("get junk ##{i}") { client.emails.get(*args, **kw) }
      guard("list ##{i}") { client.emails.list(*args, **kw) }
      guard("each ##{i}") { client.emails.each(*args, **kw).first(2) }
      guard("wait ##{i}") { client.emails.wait(junk.chance(0.5) ? 1 : junk.value, **kw.slice(:timeout, :interval, :cancel)) }
      guard("status ##{i}") { client.status(*args, **kw) }
      guard("health ##{i}") { client.health(*args, **kw) }
    end
  end

  def test_client_construction_with_junk
    junk = Junk.new(SEED + 3)
    ITERATIONS.times do |i|
      opts = junk.options(Unsent::Client::OPTION_KEYS)
      opts[:env] = {} unless junk.chance(0.1)
      guard("new ##{i}") { Unsent::Client.new(opts) }
      guard("new positional ##{i}") { Unsent::Client.new(*Array.new(junk.int(3)) { junk.value }) }
      guard("from_env ##{i}") { Unsent::Client.from_env(junk.value, **opts.slice(:timeout, :max_retries)) }
      guard("valid base + junk ##{i}") do
        Unsent::Client.new(base_url: BASE, api_key: junk.string, api_secret: junk.chance(0.5) ? junk.string : nil, env: {},
                           default_from: junk.value, default_provider_id: junk.value, timeout: junk.value, max_retries: junk.value)
      end
    end
  end

  def test_attachment_helpers_with_junk
    junk = Junk.new(SEED + 4)
    client = fuzz_client
    ITERATIONS.times do |i|
      guard("from_file ##{i}") { Unsent::Attachment.from_file(junk.value, filename: junk.value, content_type: junk.value) }
      guard("attachments ##{i}") { client.send_email(to: 'a@b.co', subject: 's', html: 'h', attachments: Array.new(1 + junk.int(3)) { junk.attachment }) }
    end
  end

  def test_cancel_token_and_secret_with_junk
    junk = Junk.new(SEED + 5)
    ITERATIONS.times do
      token = Unsent::CancelToken.new
      token.cancel! if junk.chance(0.5)
      token.wait(0.0001) if junk.chance(0.3)
      token.on_cancel { nil }
    end
    s = Unsent::Secret.new('x')
    assert_equal '[REDACTED]', "#{s}"
  end

  # --- hostile servers ---------------------------------------------------------------------------------------

  def hostile_response(junk)
    status = junk.chance(0.4) ? junk.pick([200, 202, 200, 202]) : junk.pick([100, 199, 200, 201, 204, 299, 301, 302, 307, 400, 401, 403, 404, 409, 413, 418, 429, 500, 501, 502, 503, 505, 599])
    headers = {}
    headers['Retry-After'] = junk.pick(['9' * 400, 'soon', '-1', '1e999', '0', '3', Time.now.httpdate, junk.string(30)]) if junk.chance(0.4)
    headers['Date'] = junk.pick([Time.now.httpdate, junk.string(40), '', 'Thu, 99 Foo 99999 99:99:99 GMT', (Time.now + 99_999_999).httpdate]) if junk.chance(0.4)
    headers['Location'] = junk.string(300) if junk.chance(0.3)
    headers['Content-Length'] = junk.pick(['99999999999999999999', 'abc', '-5', '5', '0']) if junk.chance(0.2)
    headers[junk.string(8)] = junk.string(30) if junk.chance(0.3)
    body = case junk.int(9)
           when 0 then JSON.generate(junk.json_value)
           when 1 then junk.string(500)
           when 2 then '{' * 5000 + '}' * 5000
           when 3 then '[' * 200_000
           when 4 then '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"id":"7","emails":[{"__proto__":1}]}'
           when 5 then '{"id":1e999,"total":-1e999,"timestamp":1e999,"limit":"NaN","emails":[1e400]}'
           when 6 then ''
           when 7 then "\xff\xfe{\"id\":1}".b
           else JSON.generate(id: junk.json_value, status: junk.json_value, emails: junk.json_value, email: junk.json_value,
                              total: junk.json_value, queued: junk.json_value, timestamp: junk.json_value, code: junk.json_value,
                              error: junk.json_value, reason: junk.json_value)
           end
    Unsent::Transport::Response.new(status: status, headers: headers, body: body)
  rescue JSON::GeneratorError
    Unsent::Transport::Response.new(status: 200, headers: {}, body: '{}')
  end

  def test_hostile_server_responses_never_crash_or_hang
    junk = Junk.new(SEED + 6)
    ITERATIONS.times do |i|
      resp = hostile_response(junk)
      client, = setup_client(max_retries: junk.int(3)) { resp }
      guard("hostile send ##{i}") { client.send_email(**MSG) }
      guard("hostile get ##{i}") { client.emails.get(1) }
      guard("hostile list ##{i}") { client.emails.list }
      guard("hostile each ##{i}") { client.emails.each(limit: 1).first(3) }
      guard("hostile status ##{i}") { client.status }
      guard("hostile health ##{i}") { client.health }
      guard("hostile wait ##{i}") { client.emails.wait(1, timeout: 3) }
    end
  end

  def test_garbage_from_the_transport_itself
    junk = Junk.new(SEED + 7)
    ITERATIONS.times do |i|
      garbage = junk.value
      kind = junk.int(4)
      transport = lambda do |_r|
        raise garbage if kind == 0 && garbage.is_a?(Exception)
        raise IOError, 'x' if kind == 1

        garbage
      end
      client = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: transport, clock: FakeClock.new, env: {}, max_retries: 2)
      guard("garbage transport ##{i}") { client.status }
      guard("garbage transport send ##{i}") { client.send_email(**MSG) }
    end
  end

  def test_a_giant_response_is_rejected_quickly
    client, t = setup_client { raw(200, 'a' * (33 * 1024 * 1024)) }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    err = assert_raises(Unsent::Error) { client.status }
    assert_equal 'response_too_large', err.code
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 2
    assert_equal 1, t.calls.length
  end

  def test_a_response_exactly_at_the_limit_is_still_parsed
    pad = ' ' * (32 * 1024 * 1024 - 20)
    client, = setup_client { raw(200, %({"queued":4}#{pad})) }
    assert_equal 4, client.status.queued
  end

  def test_a_never_ending_body_over_a_real_socket_is_cut_off
    server = TinyServer.new do |_l, _h, _b, sock|
      sock.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
      chunk = 'x' * 65_536
      loop { sock.write(chunk) }
    end
    client = Unsent::Client.new(base_url: server.base_url, api_key: API_KEY, env: {}, timeout: 15, max_retries: 0)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    err = assert_raises(Unsent::Error) { client.status }
    assert_equal 'response_too_large', err.code
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 14
  ensure
    server&.stop
  end

  def test_a_slow_drip_body_over_a_real_socket_hits_the_overall_timeout
    server = TinyServer.new do |_l, _h, _b, sock|
      sock.write("HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n")
      loop do
        sock.write('x')
        sleep 0.05
      end
    end
    client = Unsent::Client.new(base_url: server.base_url, api_key: API_KEY, env: {}, timeout: 0.4, max_retries: 0)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    assert_raises(Unsent::TimeoutError) { client.status }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 3
  ensure
    server&.stop
  end

  def test_a_lying_content_length_over_a_real_socket
    server = TinyServer.new { |*| TinyServer.http(200, '{"queued":1}', 'Content-Length' => '99999999999') }
    client = Unsent::Client.new(base_url: server.base_url, api_key: API_KEY, env: {}, max_retries: 0)
    err = assert_raises(Unsent::Error) { client.status }
    assert_equal 'response_too_large', err.code
  ensure
    server&.stop
  end

  def test_pathological_inputs_are_fast
    client = fuzz_client
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    ['<' * 100_000, ' ' * 100_000, '"' * 100_000, '@' * 100_000, ('a <' * 50_000), ('x' * 100_000) + '>', '<' + 'a' * 100_000 + '>'].each do |s|
      guard('slow from') { client.send_email(**MSG, from: s) }
      guard('slow to') { client.send_email(**MSG, to: s) }
    end
    guard('slow b64') { client.send_email(**MSG, attachments: [{ filename: 'a', content: ('QQ==' * 25_000) + '=' }]) }
    guard('slow b64 ws') { client.send_email(**MSG, attachments: [{ filename: 'a', content: ' ' * 100_000 }]) }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 5
  end

  def test_the_whole_fuzz_run_is_deterministic_for_a_seed
    a = Junk.new(7)
    b = Junk.new(7)
    20.times { assert_equal a.send_options.keys, b.send_options.keys }
  end
end
