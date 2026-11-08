# frozen_string_literal: true

require 'uri'

module Unsent
  # @api private
  # Validation and normalization of client options.
  module Config
    LOOPBACK_HOSTS = %w[localhost 127.0.0.1 [::1]].freeze
    PRINTABLE_ASCII = /\A[\x20-\x7e]+\z/

    module_function

    # Trims a String; blank and non-String values count as unset.
    def clean(value, name)
      return nil if value.nil?
      raise ConfigError, "#{name} must be a String" unless value.is_a?(String)

      text = Util.utf8(value)
      raise ConfigError, "#{name} is not valid UTF-8" if text.nil?
      raise ConfigError, "#{name} contains a NUL character" if text.include?("\0")

      text = text.strip
      text.empty? ? nil : text
    end

    # Reads +name+ from an ENV-like Hash. Blank values count as unset.
    def env_value(env, name)
      raise ConfigError, 'env must be a Hash-like object (such as ENV)' unless Util.responds?(env, :key?) && Util.responds?(env, :[])

      clean(env[name], name)
    end

    # Credentials end up in HTTP headers, so anything but printable ASCII is refused outright.
    def credential(value, name)
      return value if value.nil?
      raise ConfigError.new("#{name} must contain only printable ASCII characters (no control characters, " \
                            'line breaks or non-ASCII). Check for stray whitespace or a corrupted secret.',
                            code: 'invalid_config') unless value.match?(PRINTABLE_ASCII)

      value
    end

    def normalize_base_url(raw)
      begin
        uri = URI.parse(raw)
      rescue URI::InvalidURIError
        raise ConfigError, "base_url #{Util.snippet(raw.inspect, 60)} is not a valid URL. " \
                           'Expected something like https://unsent.example.com'
      end
      scheme = uri.scheme&.downcase
      if scheme.nil? || uri.host.nil? || uri.host.empty?
        raise ConfigError, "base_url #{Util.snippet(raw.inspect, 60)} is not a valid URL. " \
                           'Expected something like https://unsent.example.com'
      end
      raise ConfigError, "base_url must start with https:// (got #{Util.snippet(scheme, 20)}://)" unless %w[https http].include?(scheme)
      raise ConfigError, 'base_url must not contain credentials; pass api_key / api_secret instead.' if uri.userinfo

      host = uri.host.downcase
      loopback = LOOPBACK_HOSTS.include?(host) || host.end_with?('.localhost')
      if scheme == 'http' && !loopback
        raise ConfigError, 'base_url uses plain http://, which would send your API key unencrypted. ' \
                           'Use https:// (http:// is only allowed for localhost).'
      end
      port = uri.port
      raise ConfigError, 'base_url has an invalid port' unless port.is_a?(Integer) && port.between?(1, 65_535)

      authority = port == uri.default_port ? host : "#{host}:#{port}"
      path = uri.path.to_s.sub(%r{/+\z}, '')
      "#{scheme}://#{authority}#{path}"
    end

    def timeout(value)
      return 30.0 if value.nil?
      raise ConfigError, 'timeout must be a positive, finite number of seconds' unless Util.positive_finite?(value)

      value.to_f
    end

    def max_retries(value)
      return 3 if value.nil?
      unless value.is_a?(Integer) && value.between?(0, 10)
        raise ConfigError, 'max_retries must be an integer from 0 to 10'
      end

      value
    end
  end
end
