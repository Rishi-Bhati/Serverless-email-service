#!/usr/bin/env ruby
# frozen_string_literal: true

# A Sinatra app that sends through Unsent. Run with:
#
#   gem install sinatra
#   ruby -Ilib examples/sinatra.rb
#   curl -X POST localhost:4567/signup -d 'email=customer@example.com'
#
# Exits cleanly when the credentials are missing. Uses one shared client (thread-safe) built at boot.

require 'sinatra/base'
require 'unsent'

unless ENV['UNSENT_BASE_URL'].to_s != '' && ENV['UNSENT_API_KEY'].to_s != ''
  warn 'Set UNSENT_BASE_URL and UNSENT_API_KEY (and UNSENT_API_SECRET unless your server is api-key-only).'
  exit 0
end

class App < Sinatra::Base
  # One client for the whole process: thread-safe, and it keeps the learned clock offset between requests.
  CLIENT = Unsent::Client.new(default_from: ENV.fetch('UNSENT_FROM', nil))

  post '/signup' do
    email = params['email'].to_s
    content_type :json
    begin
      result = CLIENT.send_email(
        to: email,
        subject: 'Welcome!',
        html: '<h1>Hello</h1><p>Your account is ready.</p>',
        text: 'Hello, your account is ready.',
        # A stable key makes your own retries (and double-submits) idempotent.
        idempotency_key: "welcome:#{email}"
      )
      status 202
      { id: result.id, status: result.status, replay: result.idempotent_replay }.to_json
    rescue Unsent::ValidationError => e
      status 422
      { error: e.message, code: e.code }.to_json
    rescue Unsent::Error => e
      # Never log the API key or the secret: the message already redacts them.
      warn "send failed: #{e.code} #{e.message}"
      status 502
      { error: 'could not send', code: e.code }.to_json
    end
  end

  get '/health' do
    content_type :json
    { unsent: CLIENT.health.status }.to_json
  end

  run! if app_file == $PROGRAM_NAME
end

# Exercise it without a browser: rack-test style smoke call through the real client.
if app_file == $PROGRAM_NAME
  puts 'listening on http://localhost:4567'
end
