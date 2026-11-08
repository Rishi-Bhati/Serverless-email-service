# frozen_string_literal: true

require_relative 'lib/unsent/version'

Gem::Specification.new do |spec|
  spec.name = 'unsent-sdk'
  spec.version = Unsent::VERSION
  spec.authors = ['Unsent']
  spec.summary = 'Official Ruby SDK for the self-hosted Unsent email service.'
  spec.description = 'Zero-dependency Ruby client for your self-hosted Unsent deployment: HMAC-signed requests, ' \
                     'idempotent sends with safe automatic retries, attachments, typed errors, and an ActionMailer ' \
                     'delivery method for Rails.'
  spec.homepage = 'https://github.com/Rishi-Bhati/Serverless-email-service/tree/main/sdk-ruby'
  spec.required_ruby_version = '>= 3.1'

  spec.metadata = {
    'homepage_uri' => spec.homepage,
    'source_code_uri' => spec.homepage,
    'changelog_uri' => "#{spec.homepage}/CHANGELOG.md",
    'bug_tracker_uri' => 'https://github.com/Rishi-Bhati/Serverless-email-service/issues',
    'rubygems_mfa_required' => 'true'
  }

  spec.files = Dir['lib/**/*.rb', 'sig/**/*.rbs', 'README.md', 'CHANGELOG.md'].sort
  spec.require_paths = ['lib']
  # No runtime dependencies: the SDK uses only the Ruby standard library.
end
