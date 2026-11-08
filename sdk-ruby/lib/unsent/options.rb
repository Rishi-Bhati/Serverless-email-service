# frozen_string_literal: true

module Unsent
  # @api private
  # Normalizes the `(hash = nil, **keywords)` calling convention used by every public method, so that junk
  # arguments produce {ValidationError} instead of ArgumentError / NoMethodError.
  module Options
    module_function

    # @param args [Array] positional arguments (at most one Hash)
    # @param kwargs [Hash] keyword arguments
    # @param allowed [Array<Symbol>]
    # @return [Hash{Symbol=>Object}]
    def parse(args, kwargs, allowed, what, error: ValidationError)
      if args.length > 1
        raise error, "#{what} takes keyword options only (got #{args.length} positional arguments)"
      end

      first = args.first
      unless first.nil? || first.is_a?(Hash)
        raise error, "#{what} needs an options Hash or keyword arguments, got #{Util.snippet(first.class.name, 40)}"
      end

      merged = {}
      [first || {}, kwargs].each do |source|
        source.each do |key, value|
          unless key.is_a?(Symbol) || key.is_a?(String)
            raise error, "#{what} got an unsupported option key: #{Util.show(key, 40)}"
          end

          name = Util.utf8(key.to_s)
          raise error, "#{what} got an unsupported option key: #{Util.show(key, 40)}" if name.nil?

          sym = name.to_sym
          unless allowed.include?(sym)
            raise error, "#{what} got an unknown option #{Util.show(sym, 40)} " \
                         "(known: #{allowed.join(', ')})"
          end
          merged[sym] = value
        end
      end
      merged
    end

    # Per-call transport overrides, validated like the client options.
    def request_options(opts)
      timeout = opts[:timeout]
      unless timeout.nil? || Util.positive_finite?(timeout)
        raise ValidationError, '"timeout" must be a positive number of seconds'
      end
      retries = opts[:max_retries]
      unless retries.nil? || (retries.is_a?(Integer) && retries.between?(0, 10))
        raise ValidationError, '"max_retries" must be an integer from 0 to 10'
      end
      cancel = opts[:cancel]
      raise ValidationError, '"cancel" must be an Unsent::CancelToken' unless cancel.nil? || cancel.is_a?(CancelToken)

      { timeout: timeout, max_retries: retries, cancel: cancel }
    end
  end
end
