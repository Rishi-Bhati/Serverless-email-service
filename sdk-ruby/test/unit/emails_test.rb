# frozen_string_literal: true

require_relative '../test_helper'

# Shapes copied from GET /api/emails and GET /api/emails/:id in src/index.ts.
module EmailFixtures
  def list_row(over = {})
    {
      'id' => 3, 'to_json' => '["a@b.co"]', 'subject' => 'Hello', 'body' => '<p>Hi</p>', 'html_body' => '<p>Hi</p>',
      'text_body' => '<p>Hi</p>', # the API falls back to html when no text part was stored
      'from_email' => 'me@x.co', 'from_name' => 'Me', 'provider_id' => nil, 'provider_used' => 'SES',
      'failover_history' => '[{"provider":"SMTP","type":"smtp","error":"timeout","timestamp":1780000000000}]',
      'idempotency_key' => 'k-1', 'status' => 'sent', 'attempts' => 1, 'error' => nil, 'error_message' => nil,
      'created_at' => 1_780_000_000_000, 'updated_at' => 1_780_000_005_000, 'to' => ['a@b.co'],
      'attachments' => [{ 'filename' => 'a.pdf', 'mimeType' => 'application/pdf', 'size' => 1234 }], 'attachment_count' => 1
    }.merge(over)
  end
end

class EmailsGetTest < UnsentTestCase
  include EmailFixtures

  def test_maps_the_detail_response_with_times_and_decoded_attachment_sizes
    c, t = setup_client do
      json('email' => list_row('text_body' => 'Hi', 'cc' => ['c@d.co'],
                               'attachments' => [{ 'filename' => 'a.txt', 'mimeType' => 'text/plain', 'content' => 'aGVsbG8=' }]))
    end
    e = c.emails.get(3)
    assert_equal '/api/emails/3', t.calls[0].path
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    assert_nil t.calls[0].header('X-Signature')
    assert_equal 3, e.id
    assert_equal 'sent', e.status
    assert_equal ['a@b.co'], e.to
    assert_equal ['c@d.co'], e.cc
    assert_nil e.bcc
    assert_equal 'Hello', e.subject
    assert_equal '<p>Hi</p>', e.html_body
    assert_equal 'Hi', e.text_body
    assert_equal %w[me@x.co Me SES k-1], [e.from_email, e.from_name, e.provider_used, e.idempotency_key]
    assert_equal 1, e.attempts
    assert_nil e.error
    assert_equal Time.at(1_780_000_000).utc, e.created_at
    assert_equal Time.at(1_780_000_005).utc, e.updated_at
    assert_predicate e.created_at, :utc?
    assert_equal [Unsent::FailoverAttempt.new(provider: 'SMTP', type: 'smtp', error: 'timeout', timestamp: Time.at(1_780_000_000).utc)],
                 e.failover_history
    att = e.attachments[0]
    assert_equal ['a.txt', 'text/plain', 5, 'aGVsbG8='], [att.filename, att.mime_type, att.size, att.content]
    assert_equal 'hello', att.data
    assert_predicate e, :sent?
    assert_predicate e, :final?
    refute_predicate e, :failed?
    assert_predicate e, :frozen?
  end

  def test_reports_text_body_as_nil_when_the_api_only_echoed_the_html_body
    c, = setup_client { json('email' => list_row) }
    assert_nil c.emails.get(3).text_body
  end

  def test_raises_not_found_for_unknown_ids
    c, = setup_client { api_error(404, 'not_found', 'Email not found') }
    assert_raises(Unsent::NotFoundError) { c.emails.get(999) }
  end

  def test_rejects_invalid_ids_without_a_request
    c, t = setup_client { json({}) }
    [0, -1, 1.5, Float::NAN, '3', nil, true, [3], 2**60].each do |id|
      assert_raises(Unsent::ValidationError, id.inspect) { c.emails.get(id) }
    end
    assert_raises(Unsent::ValidationError) { c.emails.get }
    assert_raises(Unsent::ValidationError) { c.emails.get(3, 4) }
    assert_no_requests t
  end

  def test_tolerates_a_malformed_failover_history
    ['{not json', 'null', '{}', '"x"', 5, [1, 'x', nil]].each do |fh|
      c, = setup_client { json('email' => list_row('failover_history' => fh)) }
      history = c.emails.get(3).failover_history
      assert_kind_of Array, history
    end
    c, = setup_client { json('email' => list_row('failover_history' => '{not json')) }
    assert_equal [], c.emails.get(3).failover_history
  end

  def test_survives_a_wrongly_typed_payload_without_crashing
    weird = { 'id' => 'x', 'status' => 5, 'to' => 'a@b.co', 'cc' => [1, 'c@d.co'], 'subject' => nil, 'attempts' => 'many',
              'created_at' => 'soon', 'updated_at' => '1e999', 'attachments' => [1, nil, { 'content' => 5 }], 'html_body' => 5 }
    c, = setup_client { json('email' => weird) }
    e = c.emails.get(1)
    assert_equal 0, e.id
    assert_equal 'queued', e.status
    assert_equal [], e.to
    assert_equal ['c@d.co'], e.cc
    assert_equal '', e.subject
    assert_equal Time.at(0).utc, e.created_at
    assert_equal 3, e.attachments.length
  end

  def test_rejects_responses_that_are_not_an_email_object
    ['{}', '[]', '{"email":5}', '{"email":[]}', '5', 'null'].each do |body|
      c, = setup_client { raw(200, body) }
      err = assert_raises(Unsent::Error, body) { c.emails.get(1) }
      assert_equal 'invalid_response', err.code
    end
  end

  def test_status_predicates
    c, = setup_client { json('email' => list_row('status' => 'failed', 'attempts' => 2)) }
    e = c.emails.get(1)
    assert_predicate e, :failed?
    refute_predicate e, :final?
    refute_predicate e, :sent?
  end
end

class EmailsListTest < UnsentTestCase
  include EmailFixtures

  def test_builds_the_query_and_maps_the_page
    c, t = setup_client { json('emails' => [list_row, list_row('id' => 2)], 'results' => [], 'total' => 5, 'limit' => 2, 'offset' => 0) }
    page = c.emails.list(limit: 2, status: :failed, search: 'invoice', from: Time.utc(2026, 1, 5, 23), to: '2026-02-01', sort: 'created_at_asc')
    assert_equal({ 'limit' => '2', 'status' => 'failed', 'q' => 'invoice', 'from' => '2026-01-05', 'to' => '2026-02-01', 'sort' => 'created_at_asc' },
                 t.calls[0].query)
    assert_equal [3, 2], page.emails.map(&:id)
    assert_equal [5, 2, 0, true], [page.total, page.limit, page.offset, page.has_more]
    assert_equal [Unsent::AttachmentInfo.new(filename: 'a.pdf', mime_type: 'application/pdf', size: 1234)], page.emails[0].attachments
    assert_equal [3, 2], page.map(&:id)
    assert_equal 2, page.count
    assert_predicate page, :has_more?
  end

  def test_date_and_datetime_and_time_zones_use_utc_days
    c, t = setup_client { json('emails' => [], 'total' => 0) }
    c.emails.list(from: Date.new(2026, 3, 4), to: DateTime.new(2026, 3, 4, 23, 0, 0, '-05:00'))
    assert_equal '2026-03-04', t.calls[0].query['from']
    assert_equal '2026-03-05', t.calls[0].query['to']
    c.emails.list(from: Time.new(2026, 3, 4, 1, 0, 0, '+05:00'))
    assert_equal '2026-03-03', t.calls[1].query['from']
  end

  def test_omits_unset_params_and_reports_has_more_false_on_the_last_page
    c, t = setup_client { json('emails' => [list_row], 'total' => 1, 'limit' => 100, 'offset' => 0) }
    page = c.emails.list
    assert_nil t.calls[0].url.query
    refute page.has_more
    assert_equal [], c.emails.list(search: '').then { t.calls[1].query.keys - [] }
  end

  INVALID = [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: '5' }, { offset: -1 }, { offset: 1.5 }, { from: 'yesterday' },
             { from: 5 }, { to: 'x' }, { status: 'bogus' }, { status: 5 }, { sort: 'bogus' }, { sort: :random }, { search: 5 },
             { search: 'x' * 501 }, { nope: 1 }, { timeout: -1 }].freeze

  INVALID.each_with_index do |opts, i|
    define_method("test_rejects_invalid_list_options_#{i}") do
      c, t = setup_client { json({}) }
      assert_raises(Unsent::ValidationError, opts.inspect) { c.emails.list(**opts) }
      assert_no_requests t
    end
  end

  def test_rejects_malformed_list_responses
    ['[]', '{"emails":5}', '{"emails":[1]}', '{"emails":{}}', '5'].each do |body|
      c, = setup_client { raw(200, body) }
      assert_equal 'invalid_response', assert_raises(Unsent::Error, body) { c.emails.list }.code
    end
    c, = setup_client { raw(200, '{"total":"x","limit":null}') }
    page = c.emails.list
    assert_equal [0, 0, 0], [page.total, page.limit, page.emails.length]
  end

  def test_each_walks_every_page_oldest_first_and_stops
    all = Array.new(5) { |i| list_row('id' => i + 1) }
    c, t = setup_client do |r|
      off = r.query.fetch('offset', 0).to_i
      lim = r.query.fetch('limit', 100).to_i
      json('emails' => all[off, lim] || [], 'total' => all.length, 'limit' => lim, 'offset' => off)
    end
    ids = []
    c.emails.each(limit: 2) { |e| ids << e.id }
    assert_equal [1, 2, 3, 4, 5], ids
    assert_equal %w[0 2 4], t.calls.map { |r| r.query['offset'] }
    assert_equal 'created_at_asc', t.calls[0].query['sort']
  end

  def test_each_returns_a_lazy_enumerator_without_a_block
    all = Array.new(5) { |i| list_row('id' => i + 1) }
    c, t = setup_client do |r|
      off = r.query.fetch('offset', 0).to_i
      lim = r.query.fetch('limit', 100).to_i
      json('emails' => all[off, lim] || [], 'total' => all.length, 'limit' => lim, 'offset' => off)
    end
    enum = c.emails.each(limit: 2, sort: :updated_at_desc)
    assert_kind_of Enumerator, enum
    assert_no_requests t
    assert_equal [1, 2, 3], enum.first(3).map(&:id)
    assert_equal 2, t.calls.length, 'only the pages needed were fetched'
    assert_equal [1, 2, 3, 4, 5], c.emails.iterate(limit: 3).map(&:id)
    assert_equal 'updated_at_desc', t.calls[0].query['sort']
    assert_equal 5, c.emails.each.lazy.map(&:id).to_a.length
  end

  def test_each_validates_eagerly_and_forbids_offset
    c, t = setup_client { json({}) }
    assert_raises(Unsent::ValidationError) { c.emails.each(limit: 0) }
    assert_raises(Unsent::ValidationError) { c.emails.each(offset: 3) }
    assert_no_requests t
  end

  def test_each_ends_on_an_empty_collection_and_on_a_server_that_over_reports_total
    c, t = setup_client { json('emails' => [], 'total' => 10, 'limit' => 100, 'offset' => 0) }
    assert_equal [], c.emails.each.to_a
    assert_equal 1, t.calls.length
  end

  def test_each_propagates_errors_from_a_later_page
    c, = setup_client do |r|
      r.n == 1 ? json('emails' => [list_row], 'total' => 5, 'limit' => 1, 'offset' => 0) : api_error(401, 'invalid_api_key', 'no')
    end
    seen = []
    assert_raises(Unsent::AuthenticationError) { c.emails.each(limit: 1) { |e| seen << e.id } }
    assert_equal [3], seen
  end
end

class EmailsWaitTest < UnsentTestCase
  include EmailFixtures

  def test_polls_until_sent_with_a_growing_interval
    seq = %w[queued sending sent]
    c, t, clock = setup_client { |r| json('email' => list_row('status' => seq[r.n - 1])) }
    e = c.emails.wait(3)
    assert_equal 'sent', e.status
    assert_equal 3, t.calls.length
    assert_equal [1.0, 1.5], clock.slept
  end

  def test_the_interval_grows_to_five_seconds_and_no_further
    c, _t, clock = setup_client { |r| json('email' => list_row('status' => r.n < 9 ? 'queued' : 'sent')) }
    c.emails.wait(3, timeout: 600, interval: 1)
    assert_equal [1.0, 1.5, 2.25, 3.375, 5.0, 5.0, 5.0, 5.0], clock.slept.map { |s| s.round(3) }
  end

  def test_keeps_waiting_on_a_failed_email_with_retries_left_and_returns_once_attempts_are_exhausted
    seq = [{ 'status' => 'failed', 'attempts' => 1 }, { 'status' => 'failed', 'attempts' => 2 },
           { 'status' => 'failed', 'attempts' => Unsent::MAX_DELIVERY_ATTEMPTS }]
    c, t = setup_client { |r| json('email' => list_row(seq[r.n - 1].merge('error' => 'boom'))) }
    e = c.emails.wait(3)
    assert_equal ['failed', 3, 'boom'], [e.status, e.attempts, e.error]
    assert_equal 3, t.calls.length
  end

  def test_times_out_with_timeout_error
    c, = setup_client { json('email' => list_row('status' => 'queued', 'attempts' => 0)) }
    err = assert_raises(Unsent::TimeoutError) { c.emails.wait(3, timeout: 3) }
    assert_match(/Email 3.*queued.*3 s/, err.message)
    assert_equal 'timeout', err.code
  end

  def test_sleeps_never_overshoot_the_deadline
    c, _t, clock = setup_client { json('email' => list_row('status' => 'queued')) }
    assert_raises(Unsent::TimeoutError) { c.emails.wait(3, timeout: 2, interval: 1.5) }
    assert_in_delta 2.0, clock.slept.sum, 1e-9
  end

  def test_can_be_cancelled
    token = Unsent::CancelToken.new
    t = MockTransport.new { json('email' => list_row('status' => 'queued', 'attempts' => 0)) }
    c = Unsent::Client.new(base_url: BASE, api_key: API_KEY, transport: t, env: {})
    Thread.new { sleep 0.1; token.cancel! }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    err = assert_raises(Unsent::ConnectionError) { c.emails.wait(3, cancel: token) }
    assert_equal 'aborted', err.code
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.9
  end

  def test_propagates_lookup_errors
    c, = setup_client { api_error(404, 'not_found', 'Email not found') }
    assert_raises(Unsent::NotFoundError) { c.emails.wait(3) }
  end

  def test_validates_arguments_without_a_request
    c, t = setup_client { json({}) }
    [0, '3', nil, 1.5].each { |id| assert_raises(Unsent::ValidationError) { c.emails.wait(id) } }
    [0, -1, Float::NAN, 'x', true].each do |bad|
      assert_raises(Unsent::ValidationError) { c.emails.wait(3, timeout: bad) }
      assert_raises(Unsent::ValidationError) { c.emails.wait(3, interval: bad) }
    end
    assert_raises(Unsent::ValidationError) { c.emails.wait(3, nope: 1) }
    assert_no_requests t
  end
end

class StatusAndHealthTest < UnsentTestCase
  def test_status_returns_counters_with_defaults
    c, t = setup_client { json(queued: 1, sending: 2, sent: 3, failed: 4) }
    s = c.status
    assert_equal({ queued: 1, sending: 2, sent: 3, failed: 4 }, s.to_h)
    assert_equal '/api/status', t.calls[0].path
    assert_equal API_KEY, t.calls[0].header('X-API-Key')
    c2, = setup_client { json({}) }
    assert_equal({ queued: 0, sending: 0, sent: 0, failed: 0 }, c2.status.to_h)
  end

  def test_health_needs_no_credentials
    c, t = setup_client { json(status: 'ok', runtime: 'cf_worker', d1: 'bound', timestamp: 1_780_000_000_000) }
    h = c.health
    assert_equal ['ok', 'cf_worker', 'bound', Time.at(1_780_000_000).utc], [h.status, h.runtime, h.d1, h.timestamp]
    assert_predicate h, :ok?
    assert_nil t.calls[0].header('X-API-Key')
    assert_equal '/api/health', t.calls[0].path
  end

  def test_status_rejects_bad_credentials_with_a_hint
    c, = setup_client { api_error(401, 'invalid_api_key', 'Unauthorized: Invalid credentials or expired session') }
    err = assert_raises(Unsent::AuthenticationError) { c.status }
    assert_equal [401, 'invalid_api_key'], [err.status, err.code]
    assert_match(/API_KEY/, err.hint)
  end

  def test_status_and_health_reject_non_object_responses
    ['[]', '5', 'null', '"x"'].each do |body|
      c, = setup_client { raw(200, body) }
      assert_equal 'invalid_response', assert_raises(Unsent::Error) { c.status }.code
      assert_equal 'invalid_response', assert_raises(Unsent::Error) { c.health }.code
    end
  end

  def test_request_options_are_accepted_everywhere_and_junk_is_rejected
    c, = setup_client { json(queued: 0) }
    c.status(timeout: 5, max_retries: 0, cancel: Unsent::CancelToken.new)
    c.health(timeout: 5)
    assert_raises(Unsent::ValidationError) { c.status(bogus: 1) }
    assert_raises(Unsent::ValidationError) { c.health(1, 2) }
  end
end

class ModelsTest < UnsentTestCase
  def test_list_result_is_enumerable_and_frozen
    r = Unsent::ListResult.new(emails: [1, 2], total: 2, limit: 10, offset: 0)
    assert_equal [2, 4], r.map { |x| x * 2 }
    assert_predicate r, :frozen?
    assert_equal({ emails: [1, 2], total: 2, limit: 10, offset: 0, has_more: false }, r.to_h)
    assert_kind_of Enumerator, r.each
  end
end
