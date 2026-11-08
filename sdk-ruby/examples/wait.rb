#!/usr/bin/env ruby
# frozen_string_literal: true

# Waiting for delivery, inspecting emails and iterating over them.
#
#   ruby -Ilib examples/wait.rb
#
# Exits cleanly when the credentials are missing.

require 'unsent'

if ENV['UNSENT_BASE_URL'].to_s.empty? || ENV['UNSENT_API_KEY'].to_s.empty?
  warn 'Set UNSENT_BASE_URL and UNSENT_API_KEY (and UNSENT_API_SECRET unless your server is api-key-only).'
  exit 0
end

client = Unsent::Client.new

# --- waiting ----------------------------------------------------------------------------------------------

result = client.send_email(to: 'customer@example.com', subject: 'Wait for me', text: 'hi')

# Polls until the email is "sent", or "failed" after the service has used up its delivery attempts
# (Unsent::MAX_DELIVERY_ATTEMPTS). A permanent failure is a normal return value, not an exception.
email = client.emails.wait(result.id, timeout: 60, interval: 1)

if email.status == 'sent'
  puts "delivered via #{email.provider_used}"
else
  puts "failed: #{email.error}"
  email.failover_history.each { |attempt| puts "  #{attempt.provider}: #{attempt.error}" }
end

# Fail over a queue that can be slow, or abort when the caller goes away:
token = Unsent::CancelToken.new
begin
  client.emails.wait(result.id, timeout: 300, interval: 2, cancel: token)
rescue Unsent::TimeoutError => e
  puts "still not delivered: #{e.message}"
rescue Unsent::ConnectionError => e
  puts "aborted (#{e.code})" if e.code == 'aborted'
end

# --- inspecting -------------------------------------------------------------------------------------------

# get() includes the attachment content (base64) plus a #data helper that decodes it.
detail = client.emails.get(result.id)
puts [detail.id, detail.status, detail.subject, detail.attempts, detail.created_at].inspect
puts "html: #{detail.html_body.inspect}"
puts "text: #{detail.text_body.inspect}" # nil when the API only stored the html body

# list() gives one page (attachment metadata only) plus the total.
page = client.emails.list(limit: 5, status: 'sent', search: 'customer', sort: 'created_at_desc')
puts "page: #{page.emails.length} of #{page.total} (has_more: #{page.has_more})"
page.each { |e| puts "  ##{e.id} #{e.subject} -> #{e.status}" }

# Iterate every match, oldest first, fetching pages as needed (as an Enumerator or with a block).
client.emails.each(status: 'failed', limit: 50).first(10).each { |e| puts "failed: ##{e.id} #{e.error}" }
client.emails.iterate(search: 'invoice', limit: 20) do |e|
  break if e.id < 1 # stop whenever you want; pages are fetched lazily

  puts "invoice mail ##{e.id}"
end

# Dates are Time objects in UTC.
puts "first seen: #{page.emails.first.created_at.utc.iso8601}" if page.emails.first

# --- queue health -----------------------------------------------------------------------------------------

puts client.status.to_h.inspect  # { queued:, sending:, sent:, failed: } — also verifies your credentials
health = client.health           # public probe, needs no credentials
puts "health: #{health.status} (#{health.runtime}, d1 #{health.d1})"
