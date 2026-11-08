#!/usr/bin/env ruby
# frozen_string_literal: true

# The three-line quickstart.
#
#   ruby -Ilib examples/basic.rb
#
# Reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET from the environment (an explicit
# `Unsent::Client.new(base_url:, api_key:, api_secret:)` works too). Exits cleanly when they are missing.

require 'unsent'

env = ENV.values_at('UNSENT_BASE_URL', 'UNSENT_API_KEY').compact.reject(&:empty?)
if env.length < 2
  warn 'Set UNSENT_BASE_URL and UNSENT_API_KEY (and UNSENT_API_SECRET unless your server is api-key-only).'
  exit 0
end

# One client for the whole process: it is thread-safe, and it keeps the learned clock offset and the
# connection settings between calls.
client = Unsent::Client.new

result = client.send_email(
  # from: 'Acme Support <support@example.com>', # omit to use your default provider
  to: 'customer@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello</h1><p>Your account is ready.</p>',
  text: 'Hello, your account is ready.' # optional plain-text alternative
)

puts "queued as #{result.id} (#{result.status}), provider: #{result.target_provider}"
puts "idempotency key: #{result.idempotency_key}"

# Sending a text-only email is fine: the SDK derives the HTML body the API requires.
client.send_email(to: 'customer@example.com', subject: 'Plain', text: "Line one\nLine two")

# client.send_email(...) is a shortcut for client.emails.send_email(...).
# Branch on the error type/code, never on the message:
begin
  client.send_email(to: 'customer@example.com', subject: 'x' * 1001, html: '<p>too long</p>')
rescue Unsent::ValidationError => e
  puts "rejected before sending: #{e.code} - #{e.message}"
end
