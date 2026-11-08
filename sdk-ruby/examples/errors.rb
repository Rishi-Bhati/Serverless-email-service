#!/usr/bin/env ruby
# frozen_string_literal: true

# Error handling: branch on the class or the stable `code`, never on the message.
#
#   ruby -Ilib examples/errors.rb
#
# The interesting branches (validation, config) need no network; the rest run when credentials are set.

require 'unsent'

# 1. Validation errors are raised before anything is sent, so they are free to catch.
def validate_only
  client = Unsent::Client.new(base_url: 'https://unsent.example.com', api_key: 'not-used')
  begin
    client.send_email(to: 'not-an-address', subject: 'Hi', html: '<p>x</p>')
  rescue Unsent::ValidationError => e
    puts "validation: #{e.code} - #{e.message}"
  end

  begin
    client.send_email(to: 'a@b.co', subject: 'Hi', html: '<p>x</p>', idempotency_key: 'has spaces')
  rescue Unsent::ValidationError => e
    puts "validation: #{e.code} - #{e.message}"
  end
end

# 2. Config errors mean the client itself could not be built (nothing is ever sent).
def config
  Unsent::Client.new(base_url: 'http://unsent.example.com', api_key: 'k')
rescue Unsent::ConfigError => e
  puts "config: #{e.code} - #{e.message}"
end

# 3. One switch over the whole hierarchy, using `Unsent::APIError` for the fields only the server supplies.
def send_one(client)
  client.send_email(to: 'customer@example.com', subject: 'Error demo', html: '<p>hi</p>')
rescue Unsent::ValidationError => e
  puts "bad arguments (#{e.code}): #{e.message}" # nothing was sent
rescue Unsent::AuthenticationError => e
  puts "auth (#{e.code}, HTTP #{e.status}): #{e.message}"
  puts "  hint: #{e.hint}"
rescue Unsent::ConflictError => e
  puts "key reused with different content; existing email id = #{e.existing_email_id}"
rescue Unsent::RateLimitError => e
  puts "rate limited; the server asked to wait #{e.retry_after}s"
rescue Unsent::NotFoundError, Unsent::PermissionError, Unsent::RequestError => e
  puts "http #{e.status} (#{e.code}): #{e.message}"
  puts "  body: #{e.body.inspect}"
rescue Unsent::ServerError => e
  puts "server failure (#{e.code}, HTTP #{e.status}) - already retried"
rescue Unsent::TimeoutError => e
  puts "timeout: #{e.message}" # Unsent::TimeoutError < Unsent::ConnectionError
rescue Unsent::ConnectionError => e
  puts "connection (#{e.code}): #{e.message}"
  puts "  cause: #{e.cause.class}" if e.cause
rescue Unsent::Error => e
  puts "other SDK error (#{e.code}): #{e.message}" # e.g. unexpected_redirect, invalid_response
end

validate_only
config

if ENV['UNSENT_BASE_URL'].to_s.empty? || ENV['UNSENT_API_KEY'].to_s.empty?
  puts "\nSet UNSENT_BASE_URL / UNSENT_API_KEY to try the network paths."
  exit 0
end

send_one(Unsent::Client.new)

# 4. Retries are already exhausted by the time an error reaches you; disabling them is a per-call option.
begin
  Unsent::Client.new.send_email(to: 'customer@example.com', subject: 'no retries', html: '<p>x</p>',
                               max_retries: 0, timeout: 5)
rescue Unsent::Error => e
  puts "gave up immediately: #{e.code}"
end

# 5. An idempotency conflict reports the email that already owns the key.
begin
  Unsent::Client.new.send_email(to: 'customer@example.com', subject: 'conflict demo',
                               html: '<p>x</p>', idempotency_key: 'demo:conflict')
  Unsent::Client.new.send_email(to: 'customer@example.com', subject: 'conflict demo',
                               html: '<p>different body</p>', idempotency_key: 'demo:conflict')
rescue Unsent::ConflictError => e
  puts "conflict on #{e.code}: existing email ##{e.existing_email_id}"
end
