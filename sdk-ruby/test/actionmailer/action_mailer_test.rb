# frozen_string_literal: true

require 'action_mailer' # must come first: lib/unsent.rb only loads the delivery method when ActionMailer is present
require_relative '../test_helper'
require 'unsent'

# Real ActionMailer integration: ActionMailer + Mail are loaded for real, the :unsent delivery method is
# registered through ActionMailer's own `add_delivery_method` machinery, and the message that ActionMailer
# builds is translated into an `Unsent::Emails#send_email` call that we record with a mock transport.
# No network is involved (`client:` is set to a client built on the mock transport).
class ActionMailerTest < UnsentTestCase
  # Registered exactly like the Railtie does, so the registration path itself is covered.
  ActionMailer::Base.add_delivery_method :unsent, Unsent::DeliveryMethod unless
    ActionMailer::Base.delivery_methods.key?(:unsent)

  class Notifier < ActionMailer::Base
    default from: 'Acme Support <support@acme.test>'

    def welcome(to, **headers)
      headers.each { |k, v| head(k, v) }
      mail(to: to, cc: ['manager@acme.test'], bcc: 'audit@acme.test', subject: 'Welcome! ✓',
           body: nil) do |format|
        format.html { render plain: '<h1>Hello</h1><p>Your account is ready.</p>' }
        format.text { render plain: "Hello\nYour account is ready." }
      end
    end

    def text_only(to)
      mail(to: to, subject: 'Plain text only', body: 'just text')
    end

    def html_only(to)
      mail(to: to, subject: 'HTML only') { |format| format.html { render plain: '<p>only html</p>' } }
    end

    def binary_attachment(to)
      attachments['bytes.bin'] = { mime_type: 'application/octet-stream', content: BIN }
      attachments['report.csv'] = { mime_type: 'text/csv', content: "id,name\n1,Grüße\n" }
      mail(to: to, subject: 'Your files') do |format|
        format.html { render plain: '<p>Attached.</p>' }
        format.text { render plain: 'Attached.' }
      end
    end

    private

    def head(key, value)
      headers(key.to_s => value)
    end

    BIN = ((0..255).to_a.pack('C*') * 4).freeze
  end

  def setup
    super
    @transport = MockTransport.new { accepted(77) }
    @client = Unsent::Client.new(base_url: BASE, api_key: API_KEY, api_secret: API_SECRET, transport: @transport,
                                 env: {}, max_retries: 0)
    ActionMailer::Base.unsent_settings = { client: @client }
    ActionMailer::Base.delivery_method = :unsent
    ActionMailer::Base.raise_delivery_errors = true
    ActionMailer::Base.perform_deliveries = true
    Unsent::DeliveryMethod.clear_cache!
  end

  def teardown
    ActionMailer::Base.delivery_method = :test
    ActionMailer::Base.unsent_settings = {}
    Unsent::DeliveryMethod.clear_cache!
    super
  end

  def sent
    assert_equal 1, @transport.calls.length, 'exactly one send per delivered mail'
    @transport.calls[0].json
  end

  def test_translates_a_multipart_mail_with_to_cc_bcc_subject_from_html_and_text
    # `deliver!` returns the Mail::Message unless `return_response` is set (standard ActionMailer behaviour);
    # the SDK's SendResult is what the delivery method itself returns.
    message = Notifier.welcome(['a@example.com', 'b@example.com']).deliver!
    assert_kind_of Mail::Message, message

    body = sent
    assert_equal %w[a@example.com b@example.com], body['to']
    assert_equal ['manager@acme.test'], body['cc']
    assert_equal ['audit@acme.test'], body['bcc']
    assert_equal 'Welcome! ✓', body['subject']
    assert_equal '<h1>Hello</h1><p>Your account is ready.</p>', body['html']
    assert_equal "Hello\nYour account is ready.", body['text']
    assert_equal({ 'email' => 'support@acme.test', 'name' => 'Acme Support' }, body['from'])
    refute body.key?('attachments'), 'a mail without attachments sends no attachments key'
    req = @transport.calls[0]
    assert_equal "unsent-sdk-ruby/#{Unsent::VERSION}", req.header('User-Agent')
    assert_equal API_KEY, req.header('X-API-Key')
    assert_equal [true, nil], verify_signed(req), 'the delivered mail is fully signed'

    result = Unsent::DeliveryMethod.new(client: @client).deliver!(message)
    assert_equal 77, result.id, 'the delivery method returns the SDK SendResult'
    assert_equal 'queued', result.status
    assert_equal 2, @transport.calls.length
  end

  def test_translates_a_multipart_mixed_mail_with_binary_attachments_byte_exact
    Notifier.binary_attachment('a@example.com').deliver!

    body = sent
    assert_equal '<p>Attached.</p>', body['html']
    assert_equal 'Attached.', body['text']
    atts = body['attachments']
    assert_equal 2, atts.length
    assert_equal({ 'filename' => 'bytes.bin', 'mimeType' => 'application/octet-stream' }, atts[0].except('content'))
    assert_equal Notifier::BIN, atts[0]['content'].unpack1('m'), 'the binary attachment round-trips byte for byte'
    assert_equal 1024, atts[0]['content'].unpack1('m').bytesize
    assert_equal({ 'filename' => 'report.csv', 'mimeType' => 'text/csv' }, atts[1].except('content'))
    assert_equal "id,name\n1,Grüße\n", atts[1]['content'].unpack1('m').force_encoding('UTF-8')
  end

  def test_translates_text_only_and_html_only_mails
    Notifier.text_only('a@example.com').deliver!
    body = sent
    assert_equal 'just text', body['text']
    assert_equal '<div style="white-space:pre-wrap">just text</div>', body['html'],
                 'a text-only mail gets the derived HTML body'

    @transport.calls.clear
    Notifier.html_only('a@example.com').deliver!
    body = sent
    assert_equal '<p>only html</p>', body['html']
    refute body.key?('text'), 'an html-only mail sends no text part'
  end

  def test_a_provider_id_header_selects_the_provider
    %w[provider_id X-Provider-Id X-Unsent-Provider-Id].each do |header|
      @transport.calls.clear
      Notifier.welcome('a@example.com', header => 'resend_marketing').deliver!
      assert_equal 'resend_marketing', sent['provider_id'], header
    end
  end

  def test_an_idempotency_key_header_sets_the_key
    %w[X-Idempotency-Key Idempotency-Key X-Unsent-Idempotency-Key].each do |header|
      @transport.calls.clear
      Notifier.welcome('a@example.com', header => 'order-8492:shipped').deliver!
      assert_equal 'order-8492:shipped', sent['idempotency_key'], header
      assert_equal 1, @transport.calls.length
    end
    # Without the header the SDK generates a UUID, so replays are still deduplicated per delivery.
    @transport.calls.clear
    Notifier.welcome('a@example.com').deliver!
    assert_match(/\A\h{8}-\h{4}-4\h{3}-[89ab]\h{3}-\h{12}\z/, sent['idempotency_key'])
  end

  def test_per_message_headers_are_ignored_when_absent
    Notifier.welcome('a@example.com').deliver!
    body = sent
    refute body.key?('provider_id')
    assert body.key?('idempotency_key')
  end

  def test_deliver_bang_raises_the_sdk_error
    @transport = MockTransport.new { api_error(401, 'invalid_signature', 'Unauthorized', 'bad sig') }
    @client = Unsent::Client.new(base_url: BASE, api_key: API_KEY, api_secret: 'wrong', transport: @transport,
                                 env: {}, max_retries: 0)
    ActionMailer::Base.unsent_settings = { client: @client }
    Unsent::DeliveryMethod.clear_cache!

    err = assert_raises(Unsent::AuthenticationError) { Notifier.welcome('a@example.com').deliver! }
    assert_equal 'invalid_signature', err.code
    assert_match(/api_secret/, err.hint)
    assert_equal 1, @transport.calls.length
  end

  def test_deliver_bang_raises_validation_errors_before_any_request
    assert_raises(Unsent::ValidationError) do
      Notifier.welcome([]).deliver! # no recipients at all
    end
    assert_no_requests @transport
  end

  def test_a_delivery_error_surfaces_through_action_mailer_deliver_without_bang_too
    @transport = MockTransport.new { api_error(400, 'unauthorized_sender', 'Unauthorized sender') }
    @client = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: @transport, env: {}, max_retries: 0)
    ActionMailer::Base.unsent_settings = { client: @client }
    Unsent::DeliveryMethod.clear_cache!
    # ActionMailer's own `deliver` (without !) rides on deliver!, so the error still reaches the caller.
    assert_raises(Unsent::RequestError) { Notifier.welcome('a@example.com').deliver }
  end

  def test_settings_accept_client_options_and_build_a_cached_client
    t = MockTransport.new { accepted(11) }
    ActionMailer::Base.unsent_settings = { base_url: BASE, api_key: API_KEY, api_secret: API_SECRET,
                                           transport: t, default_from: 'default@acme.test' }
    Unsent::DeliveryMethod.clear_cache!
    Notifier.text_only('a@example.com').deliver!
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    assert_equal [true, nil], verify_signed(t.calls[0])
    # The client is cached per settings, so the learned clock offset and validation survive between mails.
    first = Unsent::DeliveryMethod.client_for(ActionMailer::Base.unsent_settings)
    assert_same first, Unsent::DeliveryMethod.client_for(ActionMailer::Base.unsent_settings)
  end

  def test_unknown_settings_are_rejected_at_construction
    assert_raises(Unsent::ConfigError) { Unsent::DeliveryMethod.new(api_kye: 'typo') }
    assert_raises(Unsent::ConfigError) { Unsent::DeliveryMethod.new('not a hash') }
    assert_equal({}, Unsent::DeliveryMethod.new(nil).settings)
  end

  def test_build_options_exposes_the_translation_for_tooling
    dm = Unsent::DeliveryMethod.new(client: @client)
    opts = dm.build_options(Notifier.welcome('a@example.com').message)
    assert_equal ['a@example.com'], opts[:to]
    assert_equal ['manager@acme.test'], opts[:cc]
    assert_equal ['audit@acme.test'], opts[:bcc]
    assert_equal 'Welcome! ✓', opts[:subject]
    assert_equal({ email: 'support@acme.test', name: 'Acme Support' }, opts[:from])
    assert_equal '<h1>Hello</h1><p>Your account is ready.</p>', opts[:html]
  end

  def test_settings_are_frozen_and_a_positional_hash_is_accepted
    dm = Unsent::DeliveryMethod.new({ 'base_url' => BASE, 'api_key' => API_KEY })
    assert_predicate dm.settings, :frozen?
    assert_equal BASE, dm.settings[:base_url]
  end
end
