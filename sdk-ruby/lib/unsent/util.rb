# frozen_string_literal: true

module Unsent
  # Small helpers shared by the validation code. Not part of the public API.
  module Util
    MAX_SAFE_INTEGER = 2**53 - 1

    module_function

    # Returns a valid UTF-8 copy of +value+, or nil when it is not a String or cannot be represented as UTF-8.
    # Binary / US-ASCII strings are reinterpreted as UTF-8 (they are common for data read from files and sockets).
    def utf8(value)
      return nil unless value.is_a?(String)

      enc = value.encoding
      if enc == Encoding::UTF_8
        value.valid_encoding? ? value : nil
      elsif enc == Encoding::BINARY || enc == Encoding::US_ASCII
        copy = value.dup.force_encoding(Encoding::UTF_8)
        copy.valid_encoding? ? copy : nil
      else
        begin
          value.encode(Encoding::UTF_8)
        rescue EncodingError
          nil
        end
      end
    end

    # respond_to? that cannot raise (user-supplied objects can be arbitrarily hostile).
    def responds?(object, name)
      object.respond_to?(name)
    rescue StandardError
      false
    end

    # inspect-based, bounded and exception-proof rendering of an arbitrary object for error messages.
    def show(object, max = 40)
      text = begin
        object.inspect
      rescue StandardError
        object.class.name.to_s
      end
      snippet(text, max)
    end

    def blank?(string)
      string.strip.empty?
    end

    # A finite, positive Integer/Float/Rational (not true/false/NaN/Infinity).
    def positive_finite?(value)
      return false unless value.is_a?(Integer) || value.is_a?(Float) || value.is_a?(Rational)
      return false if value.is_a?(Float) && !value.finite?

      value.positive?
    end

    # Shortens +text+ for use inside error messages.
    def snippet(text, max = 80)
      s = begin
        text.to_s
      rescue StandardError
        '?'
      end
      s = s.dup.force_encoding(Encoding::UTF_8).scrub('?').gsub(/[[:cntrl:]]/, ' ')
      s.length > max ? "#{s[0, max]}..." : s
    end

    # Lenient Number()-style conversion used on server data: anything unusable becomes +default+.
    def to_int(value, default = 0)
      case value
      when Integer then value
      when Float then value.finite? ? value.to_i : default
      when String
        s = value.strip
        return default if s.empty? || s.length > 40

        f = Float(s, exception: false)
        f && f.finite? ? f.to_i : default
      else default
      end
    end

    # Epoch milliseconds (Integer, Float or numeric String) to a UTC Time. Unusable values give the epoch.
    def to_time(value)
      ms = case value
           when Integer, Float then value
           when String
             value.length > 40 ? nil : Float(value.strip, exception: false)
           end
      return Time.at(0).utc if ms.nil? || (ms.is_a?(Float) && !ms.finite?) || ms.abs > 8.64e15

      Time.at(ms.to_f / 1000.0).utc
    end

    def present_string(value)
      value.is_a?(String) && !value.empty? ? value : nil
    end

    def to_text(value)
      case value
      when nil then ''
      when String then value
      else value.to_s
      end
    end
  end
end
