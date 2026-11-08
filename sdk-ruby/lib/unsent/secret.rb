# frozen_string_literal: true

module Unsent
  # Wraps a credential so that it cannot leak through `inspect`, `to_s`, `pp`, string interpolation,
  # YAML, JSON or Marshal. The raw value is only available through {#reveal}, which the HTTP layer
  # calls at the moment a request is built.
  class Secret
    REDACTED = '[REDACTED]'
    # Secrets shorter than this are not scrubbed from messages (a 1-character "secret" would mangle every message).
    MIN_SCRUB_LENGTH = 6

    def initialize(value)
      @value = value.dup.freeze
    end

    def reveal
      @value
    end

    def empty?
      @value.empty?
    end

    def inspect
      "#<#{self.class.name} #{REDACTED}>"
    end

    def to_s
      REDACTED
    end

    def pretty_print(pp)
      pp.text(inspect)
    end

    def to_json(*)
      REDACTED.inspect
    end

    def as_json(*)
      REDACTED
    end

    def encode_with(coder)
      coder.scalar = REDACTED
    end

    def marshal_dump
      raise TypeError, 'Unsent::Secret cannot be marshaled'
    end

    def ==(other)
      other.is_a?(Secret) && other.reveal == @value
    end
  end
end
