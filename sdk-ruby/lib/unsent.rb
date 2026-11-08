# frozen_string_literal: true

require_relative 'unsent/version'
require_relative 'unsent/errors'
require_relative 'unsent/secret'
require_relative 'unsent/util'
require_relative 'unsent/cancel_token'
require_relative 'unsent/clock'
require_relative 'unsent/address'
require_relative 'unsent/attachments'
require_relative 'unsent/models'
require_relative 'unsent/mapping'
require_relative 'unsent/transport'
require_relative 'unsent/options'
require_relative 'unsent/config'
require_relative 'unsent/http_client'
require_relative 'unsent/emails'
require_relative 'unsent/client'

# Official Ruby client for the self-hosted Unsent email service.
#
#   client = Unsent::Client.new(base_url: ENV['UNSENT_BASE_URL'], api_key: ENV['UNSENT_API_KEY'],
#                               api_secret: ENV['UNSENT_API_SECRET'])
#   client.send_email(to: 'customer@example.com', subject: 'Welcome!', html: '<h1>Hello</h1>')
#
# ActionMailer / Rails: `config.action_mailer.delivery_method = :unsent` (see {Unsent::DeliveryMethod}).
module Unsent
end

require_relative 'unsent/delivery_method' if defined?(::ActionMailer)
require_relative 'unsent/railtie' if defined?(::Rails::Railtie)
