# frozen_string_literal: true

require_relative '../test_helper'

class SendWireTest < UnsentTestCase
  def test_sends_a_correctly_signed_request_the_server_accepts
    c, t = setup_client { accepted }
    res = c.send_email(from: 'me@x.co', to: 'a@b.co', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi')
    req = t.calls[0]
    assert_equal 'POST', req.method
    assert_equal '/api/send', req.path
    assert_equal 'application/json', req.header('Content-Type')
    assert_equal 'application/json', req.header('Accept')
    assert_equal "unsent-sdk-ruby/#{Unsent::VERSION}", req.header('User-Agent')
    assert_equal API_KEY, req.header('X-API-Key')
    assert_equal [true, nil], verify_signed(req, API_SECRET, nil, now: c.instance_variable_get(:@http) && Time.now.to_f)
    assert_equal 1, res.id
    assert_equal 'queued', res.status
    assert_equal false, res.idempotent_replay
    refute_predicate res, :idempotent_replay?
  end

  def test_signature_matches_the_documented_formula
    clock = FakeClock.new(start: 1_780_000_123.9)
    c, t = setup_client(clock: clock) { accepted }
    c.send_email(**MSG)
    req = t.calls[0]
    assert_equal '1780000123', req.header('X-Timestamp')
    assert_match(/\A[0-9a-f]{32}\z/, req.header('X-Nonce'))
    body_hash = Digest::SHA256.hexdigest(req.body)
    expected = hmac_sha256_hex(API_SECRET, "1780000123\n#{req.header('X-Nonce')}\n#{body_hash}")
    assert_equal "sha256=#{expected}", req.header('X-Signature')
  end

  def test_independent_hmac_matches_known_vectors
    # RFC 4231 test case 2
    assert_equal '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
                 hmac_sha256_hex('Jefe', 'what do ya want for nothing?')
    assert_equal OpenSSL::HMAC.hexdigest('SHA256', 'k' * 100, 'm'), hmac_sha256_hex('k' * 100, 'm')
  end

  def test_never_sends_routing_or_idempotency_headers
    c, t = setup_client { accepted }
    c.send_email(from: 'me@x.co', to: 'a@b.co', subject: 's', html: 'h', provider_id: 'p1')
    %w[X-Provider-Id X-Sender-Email Idempotency-Key].each { |n| assert_nil t.calls[0].header(n), n }
    assert_equal 'p1', t.calls[0].json['provider_id']
    assert_equal({ 'email' => 'me@x.co' }, t.calls[0].json['from'])
  end

  def test_signs_unicode_and_large_bodies_byte_exactly
    c, t = setup_client { accepted }
    c.send_email(to: 'a@b.co', subject: 'Grüße 🎉', html: "<p>日本語 — \"quotes\" \\ \n</p>" * 5000)
    assert_equal [true, nil], verify_signed(t.calls[0])
    assert_includes t.calls[0].body.force_encoding('UTF-8'), '日本語'
  end

  def test_uses_a_fresh_nonce_on_every_call
    c, t = setup_client { accepted }
    20.times { c.send_email(to: 'a@b.co', subject: 's', html: 'h') }
    used = Set.new
    t.calls.each { |r| assert_equal [true, nil], verify_signed(r, API_SECRET, used) }
    assert_equal 20, used.size
  end

  def test_sends_only_the_api_key_when_no_secret_is_configured
    t = MockTransport.new { accepted }
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {})
    c.send_email(to: 'a@b.co', subject: 's', html: 'h')
    h = t.calls[0].headers
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    %w[X-Signature X-Nonce X-Timestamp].each { |n| assert_nil t.calls[0].header(n), n }
    refute_nil h
  end

  def test_get_requests_use_the_api_key_alone
    c, t = setup_client { json({ queued: 0, sending: 0, sent: 0, failed: 0 }) }
    c.status
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    assert_nil t.calls[0].header('X-Signature')
    assert_nil t.calls[0].header('Content-Type')
    assert_nil t.calls[0].request.body
  end

  def test_the_exact_serialized_body_is_what_is_signed_and_sent
    c, t = setup_client { accepted }
    c.send_email(to: ['a@b.co'], subject: 's', html: '<b>é</b>', idempotency_key: 'k1')
    assert_equal Encoding::UTF_8, t.calls[0].request.body.encoding
    assert_equal '{"to":["a@b.co"],"subject":"s","html":"<b>é</b>","idempotency_key":"k1"}', t.calls[0].body
  end
end

class SendMessageTest < UnsentTestCase
  def test_parses_name_email_and_hash_senders
    c, t = setup_client { accepted }
    c.send_email(from: 'Acme Support <help@acme.co>', **MSG)
    c.send_email(from: { email: 'help@acme.co', name: 'Acme' }, **MSG)
    c.send_email(from: { 'email' => 'help@acme.co', 'name' => 'Acme' }, **MSG)
    c.send_email(from: '"Doe, Jane" <j@acme.co>', **MSG)
    c.send_email(from: '<only@acme.co>', **MSG)
    c.send_email(from: '  plain@acme.co  ', **MSG)
    froms = t.calls.map { |r| r.json['from'] }
    assert_equal({ 'email' => 'help@acme.co', 'name' => 'Acme Support' }, froms[0])
    assert_equal({ 'email' => 'help@acme.co', 'name' => 'Acme' }, froms[1])
    assert_equal froms[1], froms[2]
    assert_equal({ 'email' => 'j@acme.co', 'name' => 'Doe, Jane' }, froms[3])
    assert_equal({ 'email' => 'only@acme.co' }, froms[4])
    assert_equal({ 'email' => 'plain@acme.co' }, froms[5])
  end

  def test_applies_default_from_and_default_provider_id_with_per_call_overrides
    c, t = setup_client(default_from: 'Default <default@x.co>', default_provider_id: 'prov-a') { accepted }
    c.send_email(**MSG)
    c.send_email(**MSG, from: 'other@x.co', provider_id: 'prov-b')
    assert_equal({ 'email' => 'default@x.co', 'name' => 'Default' }, t.calls[0].json['from'])
    assert_equal 'prov-a', t.calls[0].json['provider_id']
    assert_equal({ 'email' => 'other@x.co' }, t.calls[1].json['from'])
    assert_equal 'prov-b', t.calls[1].json['provider_id']
  end

  def test_derives_an_escaped_html_body_from_text_only_sends
    c, t = setup_client { accepted }
    c.send_email(to: 'a@b.co', subject: 's', text: "Line 1\n<b>& \"x\" 'y'</b>")
    body = t.calls[0].json
    assert_equal "Line 1\n<b>& \"x\" 'y'</b>", body['text']
    assert_equal %(<div style="white-space:pre-wrap">Line 1\n&lt;b&gt;&amp; &quot;x&quot; &#39;y&#39;&lt;/b&gt;</div>), body['html']
  end

  def test_whitespace_only_html_with_text_derives_html_from_the_text
    c, t = setup_client { accepted }
    c.send_email(to: 'a@b.co', subject: 's', html: "  \n", text: 'hi')
    assert_equal '<div style="white-space:pre-wrap">hi</div>', t.calls[0].json['html']
  end

  def test_accepts_string_or_array_recipients_plus_cc_bcc_and_omits_empty_optionals
    c, t = setup_client { accepted }
    c.send_email(to: ['a@b.co', ' c@d.co ', ''], cc: 'e@f.co', bcc: [], subject: 's', html: 'h')
    json = t.calls[0].json
    assert_equal %w[a@b.co c@d.co], json['to']
    assert_equal ['e@f.co'], json['cc']
    %w[bcc attachments from text provider_id].each { |k| refute json.key?(k), k }
    refute_includes t.calls[0].body, 'null'
  end

  def test_trims_provider_id_and_accepts_string_keyed_options
    c, t = setup_client { accepted }
    c.send_email({ 'to' => 'a@b.co', 'subject' => 's', 'html' => 'h', 'provider_id' => ' p ' })
    assert_equal 'p', t.calls[0].json['provider_id']
  end

  def test_encodes_attachments_from_every_supported_content_type
    c, t = setup_client { accepted }
    file = Tempfile.new(['up', '.txt']).tap { |f| f.binmode; f.write('file-body'); f.rewind }
    big = ("\x07".b * 100_000)
    c.send_email(
      to: 'a@b.co', subject: 's', html: 'h',
      attachments: [
        { filename: 'a.txt', content: 'hello'.b, content_type: 'text/plain' },
        { filename: 'b.bin', content: "\x00\xff\x10".b, mime_type: 'application/octet-stream' },
        { filename: 'c.txt', content: "aGVsbG8=\n" },
        { 'filename' => 'd.txt', 'content' => StringIO.new('io-body'), 'contentType' => 'text/plain' },
        { filename: 'e.bin', content: big },
        { content: file, mimeType: 'text/plain' },
        { filename: 'g.txt', content: 'aGVs bG8=' }
      ]
    )
    a = t.calls[0].json['attachments']
    assert_equal({ 'filename' => 'a.txt', 'content' => 'aGVsbG8=', 'mimeType' => 'text/plain' }, a[0])
    assert_equal ["\x00\xff\x10".b].pack('m0'), a[1]['content']
    assert_equal 'application/octet-stream', a[1]['mimeType']
    assert_equal({ 'filename' => 'c.txt', 'content' => 'aGVsbG8=' }, a[2])
    assert_equal({ 'filename' => 'd.txt', 'content' => ['io-body'].pack('m0'), 'mimeType' => 'text/plain' }, a[3])
    assert_equal [big].pack('m0'), a[4]['content']
    assert_equal File.basename(file.path), a[5]['filename']
    assert_equal ['file-body'].pack('m0'), a[5]['content']
    assert_equal 'aGVsbG8=', a[6]['content']
  ensure
    file&.close!
  end

  def test_attachment_from_file_reads_bytes_and_guesses_the_type
    Dir.mktmpdir do |dir|
      path = File.join(dir, 'Report.PDF')
      File.binwrite(path, "%PDF\x00\xff".b)
      att = Unsent::Attachment.from_file(path)
      assert_equal({ filename: 'Report.PDF', content: "%PDF\x00\xff".b, content_type: 'application/pdf' }, att)
      att = Unsent::Attachment.from_file(Pathname.new(path), filename: 'x.bin', content_type: 'a/b')
      assert_equal %w[x.bin a/b], [att[:filename], att[:content_type]]
      c, t = setup_client { accepted }
      c.send_email(**MSG, attachments: [Unsent::Attachment.from_file(path)])
      assert_equal 'application/pdf', t.calls[0].json['attachments'][0]['mimeType']
      assert_raises(Unsent::ValidationError) { Unsent::Attachment.from_file(File.join(dir, 'missing')) }
      assert_raises(Unsent::ValidationError) { Unsent::Attachment.from_file(42) }
    end
  end

  def test_attachment_filenames_are_cleaned
    c, t = setup_client { accepted }
    c.send_email(**MSG, attachments: [{ filename: " a\r\nb.txt \0", content: 'x'.b }])
    assert_equal 'ab.txt', t.calls[0].json['attachments'][0]['filename']
  end

  def test_maps_the_response_including_replays
    c, = setup_client do
      json({ success: true, id: 9, status: 'sent', idempotency_key: 'k-1', idempotent_replay: true, message: 'm', targetProvider: 'SES' },
           200, 'Idempotent-Replayed' => 'true')
    end
    res = c.send_email(**MSG, idempotency_key: 'k-1')
    assert_equal({ id: 9, status: 'sent', idempotency_key: 'k-1', idempotent_replay: true, target_provider: 'SES', message: 'm' },
                 res.to_h)
    assert_predicate res, :idempotent_replay?
    assert_predicate res, :frozen?
  end

  def test_replay_header_alone_marks_a_replay_and_unknown_status_falls_back
    c, = setup_client { json({ id: 3, status: 'weird' }, 200, 'idempotent-replayed' => 'true') }
    res = c.deliver(**MSG)
    assert_predicate res, :idempotent_replay?
    assert_equal 'queued', res.status
    assert_equal '', res.message
  end

  def test_deliver_and_client_level_shortcuts
    c, t = setup_client { accepted(4) }
    assert_equal 4, c.deliver(**MSG).id
    assert_equal 4, c.send_email(**MSG).id
    assert_equal 4, c.emails.deliver(**MSG).id
    assert_equal 4, c.emails.send_email(MSG.dup).id
    assert_equal 4, t.calls.length
  end
end

class SendIdempotencyTest < UnsentTestCase
  def test_generates_a_uuid_key_per_call_covered_by_the_signed_body
    c, t = setup_client { accepted }
    r1 = c.send_email(**MSG)
    r2 = c.send_email(**MSG)
    k1 = t.calls[0].json['idempotency_key']
    assert_match(/\A\h{8}-\h{4}-4\h{3}-[89ab]\h{3}-\h{12}\z/, k1)
    refute_equal k1, t.calls[1].json['idempotency_key']
    assert_equal k1, r1.idempotency_key
    refute_equal k1, r2.idempotency_key
  end

  def test_uses_a_caller_supplied_key_and_trims_it
    c, t = setup_client { accepted }
    c.send_email(**MSG, idempotency_key: ' order-123:receipt ')
    assert_equal 'order-123:receipt', t.calls[0].json['idempotency_key']
  end

  def test_omits_the_key_when_disabled_with_false
    c, t = setup_client { accepted }
    res = c.send_email(**MSG, idempotency_key: false)
    refute t.calls[0].json.key?('idempotency_key')
    assert_nil res.idempotency_key
  end

  def test_rejects_invalid_keys_before_any_request
    c, t = setup_client { accepted }
    ['', '  ', 'has space', "tab\there", 'ünï', 'x' * 256, 5, true, [], "a\nb", "bad\0"].each do |key|
      err = assert_raises(Unsent::ValidationError, key.inspect) { c.send_email(**MSG, idempotency_key: key) }
      assert_equal 'invalid_idempotency_key', err.code
    end
    assert_no_requests t
  end

  def test_accepts_boundary_keys
    c, t = setup_client { accepted }
    c.send_email(**MSG, idempotency_key: 'x')
    c.send_email(**MSG, idempotency_key: '~' * 255)
    c.send_email(**MSG, idempotency_key: '!')
    assert_equal 3, t.calls.length
  end
end

class SendValidationTest < UnsentTestCase
  big_att = Array.new(21) { { filename: 'a', content: 'QQ==' } }
  CASES = {
    'missing to' => [{ subject: 's', html: 'h' }, /"to" is required/],
    'nil to' => [{ to: nil, subject: 's', html: 'h' }, /"to" is required/],
    'empty to array' => [{ to: [], subject: 's', html: 'h' }, /at least one/],
    'blank to' => [{ to: '  ', subject: 's', html: 'h' }, /at least one/],
    'non-string to entry' => [{ to: [1], subject: 's', html: 'h' }, /string/],
    'hash to' => [{ to: { email: 'a@b.co' }, subject: 's', html: 'h' }, /string/],
    'address without @' => [{ to: 'nope', subject: 's', html: 'h' }, /invalid address/],
    'CRLF in address' => [{ to: "a@b.co\r\nBcc: x@y.z", subject: 's', html: 'h' }, /line break/],
    'NUL in address' => [{ to: "a@b.co\0", subject: 's', html: 'h' }, /NUL/],
    'LF in cc' => [{ to: 'a@b.co', cc: "x@y.z\nBcc: q@r.s", subject: 's', html: 'h' }, /line break/],
    '101 recipients' => [{ to: Array.new(101) { |i| "u#{i}@x.co" }, subject: 's', html: 'h' }, /maximum 100/],
    '101 bcc' => [{ to: 'a@b.co', bcc: Array.new(101) { |i| "u#{i}@x.co" }, subject: 's', html: 'h' }, /maximum 100/],
    'overlong address' => [{ to: "#{'a' * 320}@x.co", subject: 's', html: 'h' }, /longer than 320/],
    'missing subject' => [{ to: 'a@b.co', html: 'h' }, /"subject" is required/],
    'blank subject' => [{ to: 'a@b.co', subject: '   ', html: 'h' }, /"subject" is required/],
    'numeric subject' => [{ to: 'a@b.co', subject: 5, html: 'h' }, /"subject" is required/],
    'huge subject' => [{ to: 'a@b.co', subject: 'x' * 1001, html: 'h' }, /maximum 1000/],
    'no body' => [{ to: 'a@b.co', subject: 's' }, /"html", "text"/],
    'blank bodies' => [{ to: 'a@b.co', subject: 's', html: ' ', text: ' ' }, /"html", "text"/],
    'non-string html' => [{ to: 'a@b.co', subject: 's', html: 5 }, /"html" must be a string/],
    'non-string text' => [{ to: 'a@b.co', subject: 's', html: 'h', text: [] }, /"text" must be a string/],
    'invalid UTF-8 html' => [{ to: 'a@b.co', subject: 's', html: "\xff\xfe".dup.force_encoding('UTF-8') }, /"html" must be a string/],
    'attachments not array' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: {} }, /must be an array/],
    '21 attachments' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: big_att }, /maximum 20/],
    'attachment not a hash' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: ['x'] }, /must be a Hash/],
    'attachment without filename' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ content: 'QQ==' }] }, /filename is required/],
    'attachment with long filename' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'f' * 256, content: 'QQ==' }] }, /255/],
    'attachment with plain text content' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a.txt', content: 'hello world' }] }, /valid base64.*binary String/m],
    'attachment with unpadded base64' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: 'QQ' }] }, /valid base64/],
    'attachment with bad content' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: 42 }] }, /must be a base64 String/],
    'attachment without content' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a' }] }, /content is required/],
    'empty attachment' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: ''.b }] }, /empty/],
    'bad attachment type' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: 'QQ==', content_type: 5 }] }, /content_type must be a string/],
    'bad attachment key' => [{ to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: 'QQ==', 5 => 1 }] }, /unsupported key/],
    'empty from' => [{ to: 'a@b.co', subject: 's', html: 'h', from: '' }, /"from"/],
    'numeric from' => [{ to: 'a@b.co', subject: 's', html: 'h', from: 5 }, /"from"/],
    'bad from hash' => [{ to: 'a@b.co', subject: 's', html: 'h', from: { name: 'x' } }, /from\.email/],
    'from hash extra key' => [{ to: 'a@b.co', subject: 's', html: 'h', from: { email: 'a@b.co', evil: 1 } }, /unknown keys/],
    'from CRLF' => [{ to: 'a@b.co', subject: 's', html: 'h', from: "a@b.co\r\nBcc: x@y.z" }, /line break/],
    'from name CRLF' => [{ to: 'a@b.co', subject: 's', html: 'h', from: { email: 'a@b.co', name: "x\nBcc: y" } }, /line break/],
    'from non-string name' => [{ to: 'a@b.co', subject: 's', html: 'h', from: { email: 'a@b.co', name: 5 } }, /name/],
    'blank provider_id' => [{ to: 'a@b.co', subject: 's', html: 'h', provider_id: ' ' }, /provider_id/],
    'numeric provider_id' => [{ to: 'a@b.co', subject: 's', html: 'h', provider_id: 5 }, /provider_id/],
    'long provider_id' => [{ to: 'a@b.co', subject: 's', html: 'h', provider_id: 'p' * 256 }, /provider_id/],
    'unknown option' => [{ to: 'a@b.co', subject: 's', html: 'h', reply_to: 'x@y.z' }, /unknown option :reply_to/],
    'non-symbol option key' => [{ to: 'a@b.co', subject: 's', html: 'h', 5 => 1 }, /unsupported option key/],
    'bad timeout' => [{ to: 'a@b.co', subject: 's', html: 'h', timeout: 0 }, /timeout/],
    'nan timeout' => [{ to: 'a@b.co', subject: 's', html: 'h', timeout: Float::NAN }, /timeout/],
    'bad max_retries' => [{ to: 'a@b.co', subject: 's', html: 'h', max_retries: 11 }, /max_retries/],
    'bad cancel' => [{ to: 'a@b.co', subject: 's', html: 'h', cancel: Object.new }, /cancel/]
  }.freeze

  CASES.each do |name, (opts, message)|
    define_method("test_validation_#{name.gsub(/\W+/, '_')}") do
      c, t = setup_client { accepted }
      err = assert_raises(Unsent::ValidationError, name) { c.send_email(opts) }
      assert_match message, err.message, name
      assert_no_requests t
    end
  end

  def test_no_options_and_wrong_option_containers
    c, t = setup_client { accepted }
    assert_raises(Unsent::ValidationError) { c.send_email }
    assert_raises(Unsent::ValidationError) { c.send_email(nil) }
    assert_raises(Unsent::ValidationError) { c.send_email('to: a@b.co') }
    assert_raises(Unsent::ValidationError) { c.send_email([]) }
    assert_raises(Unsent::ValidationError) { c.send_email({}, {}) }
    assert_no_requests t
  end

  def test_total_body_over_three_mib_is_payload_too_large_without_a_request
    c, t = setup_client { accepted }
    err = assert_raises(Unsent::ValidationError) { c.send_email(**MSG, html: 'x' * (3 * 1024 * 1024 + 1)) }
    assert_equal 'payload_too_large', err.code
    err = assert_raises(Unsent::ValidationError) do
      c.send_email(**MSG, attachments: [{ filename: 'big', content: 'a'.b * (3 * 1024 * 1024 + 1) }])
    end
    assert_equal 'payload_too_large', err.code
    assert_no_requests t
  end

  def test_binary_and_other_encoded_strings_are_normalized_to_utf8
    c, t = setup_client { accepted }
    c.send_email(to: 'a@b.co', subject: "caf\xC3\xA9".b, html: 'café'.encode('ISO-8859-1', undef: :replace).force_encoding('ISO-8859-1'))
    json = t.calls[0].json
    assert_equal 'café', json['subject']
    assert_equal Encoding::UTF_8, t.calls[0].request.body.encoding
  end

  def test_boundary_values_are_accepted
    c, t = setup_client { accepted }
    c.send_email(to: Array.new(100) { |i| "u#{i}@x.co" }, subject: 'x' * 1000, html: 'h', attachments: Array.new(20) { { filename: 'a', content: 'QQ==' } })
    assert_equal 1, t.calls.length
  end

  def test_per_call_overrides_are_validated_and_applied
    c, t = setup_client { api_error(500, 'internal_error') }
    assert_raises(Unsent::ServerError) { c.send_email(**MSG, max_retries: 0) }
    assert_equal 1, t.calls.length
  end
end
