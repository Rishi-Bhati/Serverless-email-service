# frozen_string_literal: true

require 'rails/railtie'

module Unsent
  # Registers the +:unsent+ ActionMailer delivery method in Rails applications.
  class Railtie < ::Rails::Railtie
    initializer 'unsent.add_delivery_method', before: 'action_mailer.set_configs' do
      require_relative 'delivery_method'
      Unsent::DeliveryMethod.register!
    end
  end
end
