# frozen_string_literal: true

require 'net/http'
require 'openssl'
require 'uri'

module Unsent
  # HTTP transports. A transport is any object responding to `call(request)` that returns a {Transport::Response}
  # (or an object / Hash with `status`, `headers` and `body`), and raises on network failure. Pass one as
  # `transport:` to {Client#initialize} to stub the network in tests, route through a proxy library, or add
  # instrumentation. A transport must never follow redirects.
  module Transport
    # A request to put on the wire.
    #
    # @!attribute method [String] "GET" or "POST"
    # @!attribute url [String] absolute URL including the query string
    # @!attribute headers [Hash{String=>String}] header names in canonical casing
    # @!attribute body [String, nil] the exact bytes (UTF-8) to send
    # @!attribute timeout [Float] seconds the attempt may take
    # @!attribute max_response_bytes [Integer] the transport should stop reading beyond this many bytes
    Request = Struct.new(:method, :url, :headers, :body, :timeout, :max_response_bytes, keyword_init: true) do
      # Case-insensitive header lookup.
      def header(name)
        key = headers.keys.find { |k| k.casecmp?(name) }
        key && headers[key]
      end

      def uri
        URI.parse(url)
      end

      def json
        body && JSON.parse(body)
      end

      # Credentials never appear when a request is inspected or logged.
      def inspect
        shown = headers.to_h { |k, v| [k, k.casecmp?('x-api-key') ? Secret::REDACTED : v] }
        "#<Unsent::Transport::Request #{method} #{url} headers=#{shown.inspect} body=#{body&.bytesize.inspect} bytes>"
      end
      alias to_s inspect

      # Without this, `pp` (and anything using PP) would dump the raw Struct members, including the API key.
      def pretty_print(pp)
        pp.text(inspect)
      end
    end

    # A response. +headers+ may use any casing; the SDK looks them up case-insensitively.
    Response = Struct.new(:status, :headers, :body, keyword_init: true) do
      def initialize(status:, headers: {}, body: '')
        super
      end
    end

    # Raised by a transport that stopped reading because the response exceeded `max_response_bytes`.
    class BodyTooLarge < StandardError; end

    # The default transport, built on Net::HTTP. A fresh connection is used per request, so one instance is safe
    # to share between threads. Honours the standard `http_proxy` / `https_proxy` / `no_proxy` variables.
    class NetHTTP
      def call(request)
        uri = URI.parse(request.url)
        http = Net::HTTP.new(uri.hostname, uri.port)
        configure(http, uri, request.timeout)
        http.start do |conn|
          conn.request(build(request, uri)) { |res| return read(res, request.max_response_bytes) }
        end
      end

      private

      def configure(http, uri, timeout)
        if uri.scheme == 'https'
          http.use_ssl = true
          http.verify_mode = OpenSSL::SSL::VERIFY_PEER
          http.min_version = OpenSSL::SSL::TLS1_2_VERSION
        end
        http.open_timeout = http.read_timeout = http.write_timeout = timeout
        http.keep_alive_timeout = 0
      end

      def build(request, uri)
        klass = request.method == 'POST' ? Net::HTTP::Post : Net::HTTP::Get
        headers = request.headers.merge('Accept-Encoding' => 'identity')
        req = klass.new(uri.request_uri, headers)
        req.body = request.body if request.body
        req
      end

      def read(res, max)
        declared = res['content-length']
        raise BodyTooLarge if declared && declared.match?(/\A\d+\z/) && declared.to_i > max

        buffer = String.new(encoding: Encoding::BINARY)
        res.read_body do |chunk|
          buffer << chunk
          raise BodyTooLarge if buffer.bytesize > max
        end
        # Net::HTTP silently accepts a body that ends before its Content-Length; a truncated JSON document must not pass.
        if declared&.match?(/\A\d+\z/) && buffer.bytesize < declared.to_i && res['transfer-encoding'].to_s.empty?
          raise EOFError, "response body truncated (#{buffer.bytesize} of #{declared} bytes)"
        end
        headers = {}
        res.each_header { |k, v| headers[k] = v }
        Response.new(status: res.code.to_i, headers: headers, body: buffer)
      end
    end
  end
end
