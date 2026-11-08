# frozen_string_literal: true

require_relative '../test_helper'

class ConfigTest < UnsentTestCase
  def make(**opts)
    Unsent::Client.new(base_url: BASE, api_key: 'k', transport: MockTransport.new, env: {}, **opts)
  end

  def test_requires_base_url_and_api_key_with_actionable_messages
    err = assert_raises(Unsent::ConfigError) { Unsent::Client.new(api_key: 'k', env: {}) }
    assert_match(/base_url.*UNSENT_BASE_URL/m, err.message)
    err = assert_raises(Unsent::ConfigError) { Unsent::Client.new(base_url: BASE, env: {}) }
    assert_match(/api_key.*UNSENT_API_KEY/m, err.message)
    assert_equal 'invalid_config', err.code
    assert_kind_of Unsent::Error, err
  end

  def test_empty_and_blank_values_count_as_unset
    env = { 'UNSENT_BASE_URL' => '', 'UNSENT_API_KEY' => '   ' }
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(api_key: 'k', env: env) }
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(base_url: BASE, env: env) }
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(base_url: '', api_key: 'k', env: {}) }
  end

  def test_reads_credentials_from_the_environment_and_trims_stray_whitespace
    env = { 'UNSENT_BASE_URL' => "#{BASE}/\n", 'UNSENT_API_KEY' => " #{API_KEY}\n", 'UNSENT_API_SECRET' => "#{API_SECRET}\n" }
    t = MockTransport.new
    Unsent::Client.new(env: env, transport: t).send_email(to: 'a@b.co', subject: 's', text: 't')
    assert_equal "#{BASE}/api/send", t.calls[0].request.url
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    assert_equal [true, nil], verify_signed(t.calls[0])
  end

  def test_defaults_to_the_process_environment
    saved = ENV.to_h.slice('UNSENT_BASE_URL', 'UNSENT_API_KEY', 'UNSENT_API_SECRET')
    ENV['UNSENT_BASE_URL'] = BASE
    ENV['UNSENT_API_KEY'] = API_KEY
    ENV['UNSENT_API_SECRET'] = API_SECRET
    t = MockTransport.new
    Unsent::Client.new(transport: t).send_email(to: 'a@b.co', subject: 's', text: 't')
    assert t.calls[0].header('X-Signature')
  ensure
    %w[UNSENT_BASE_URL UNSENT_API_KEY UNSENT_API_SECRET].each { |k| ENV.delete(k) }
    saved.each { |k, v| ENV[k] = v }
  end

  def test_explicit_options_win_over_the_environment
    t = MockTransport.new
    env = { 'UNSENT_BASE_URL' => 'https://wrong.test', 'UNSENT_API_KEY' => 'wrong' }
    Unsent::Client.new(base_url: BASE, api_key: API_KEY, env: env, transport: t).send_email(to: 'a@b.co', subject: 's', text: 't')
    assert_equal 'unsent.test', t.calls[0].url.host
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
  end

  def test_from_env_works_with_a_plain_hash_and_accepts_overrides
    t = MockTransport.new
    c = Unsent::Client.from_env({ 'UNSENT_BASE_URL' => BASE, 'UNSENT_API_KEY' => API_KEY, 'UNSENT_API_SECRET' => API_SECRET },
                                transport: t, default_from: 'me@x.co')
    c.send_email(to: 'a@b.co', subject: 's', text: 't')
    assert_match(/\Asha256=\h{64}\z/, t.calls[0].header('X-Signature'))
    assert_equal({ 'email' => 'me@x.co' }, t.calls[0].json['from'])
    assert_raises(Unsent::ConfigError) { Unsent::Client.from_env(42) }
  end

  def test_keeps_a_path_prefix_and_drops_query_hash_and_trailing_slashes
    t = MockTransport.new
    Unsent::Client.new(base_url: "#{BASE}/mail//?x=1#y", api_key: API_KEY, transport: t, env: {}).send_email(to: 'a@b.co', subject: 's', text: 't')
    assert_equal "#{BASE}/mail/api/send", t.calls[0].request.url
  end

  def test_normalizes_host_case_and_default_ports
    assert_equal 'https://unsent.example.com', make(base_url: 'HTTPS://Unsent.Example.COM:443').base_url
    assert_equal 'https://unsent.example.com:8443/x', make(base_url: 'https://unsent.example.com:8443/x/').base_url
  end

  def test_rejects_malformed_urls_other_protocols_embedded_credentials_and_plain_http_to_remote_hosts
    {
      'not a url' => /not a valid URL/, 'ftp://x.test' => /https/, 'file:///etc/passwd' => /https|valid/,
      'http://unsent.example.com' => /plain http/, 'https://user:pw@unsent.example.com' => /credentials/,
      'https://user@unsent.example.com' => /credentials/, 'https://' => /not a valid URL/, '//x.test' => /not a valid URL/,
      'unsent.example.com' => /not a valid URL/, 'https://x.test:99999' => /port/, 'javascript:alert(1)' => /valid|https/
    }.each do |url, pattern|
      err = assert_raises(Unsent::ConfigError, url) { make(base_url: url) }
      assert_match(pattern, err.message, url)
    end
  end

  def test_allows_http_for_loopback_development_servers
    ['localhost:8787', '127.0.0.1:8787', '[::1]:8787', 'dev.localhost'].each do |host|
      make(base_url: "http://#{host}")
    end
    assert_raises(Unsent::ConfigError) { make(base_url: 'http://127.0.0.2:8787') }
    assert_raises(Unsent::ConfigError) { make(base_url: 'http://evil-localhost.com') }
  end

  def test_validates_timeout_and_max_retries
    [0, -1, Float::NAN, Float::INFINITY, '5', true, [], 0.0].each do |bad|
      assert_raises(Unsent::ConfigError, "timeout #{bad.inspect}") { make(timeout: bad) }
    end
    [-1, 1.5, 11, '3', true, 1_000].each do |bad|
      assert_raises(Unsent::ConfigError, "max_retries #{bad.inspect}") { make(max_retries: bad) }
    end
    make(timeout: 0.5)
    make(timeout: 5)
    make(max_retries: 0)
    make(max_retries: 10)
  end

  def test_rejects_unknown_options_and_wrong_option_container_types
    err = assert_raises(Unsent::ConfigError) { make(apikey: 'x') }
    assert_match(/unknown option/, err.message)
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(42) }
    assert_raises(Unsent::ConfigError) { Unsent::Client.new(1, 2) }
    assert_raises(Unsent::ConfigError) { make(transport: 42) }
    assert_raises(Unsent::ConfigError) { make(clock: Object.new) }
    assert_raises(Unsent::ConfigError) { make(base_url: 42) }
    assert_raises(Unsent::ConfigError) { make(api_secret: 42) }
  end

  def test_validates_defaults_at_construction
    assert_raises(Unsent::ConfigError) { make(default_from: 42) }
    assert_raises(Unsent::ConfigError) { make(default_from: "a@b.co\r\nBcc: x@y.z") }
    assert_raises(Unsent::ConfigError) { make(default_provider_id: '   ') }
    assert_raises(Unsent::ConfigError) { make(default_provider_id: 'x' * 256) }
  end

  def test_accepts_a_positional_options_hash
    c = Unsent::Client.new({ base_url: BASE, api_key: 'k', env: {} })
    assert_equal BASE, c.base_url
  end

  def test_client_is_frozen_and_the_emails_resource_is_shared
    c = make
    assert_predicate c, :frozen?
    assert_same c.emails, c.emails
  end

  def test_send_is_not_shadowed
    c = make
    assert_equal BASE, c.send(:base_url) # Object#send keeps working for ordinary Ruby metaprogramming
    assert_equal BASE, c.emails.then { c.public_send(:base_url) }
    refute_includes Unsent::Client.instance_methods(false), :send
    refute_includes Unsent::Emails.instance_methods(false), :send
  end
end
