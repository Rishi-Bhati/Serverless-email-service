# frozen_string_literal: true

module Unsent
  # Parsing and validation of sender and recipient addresses. All scans are linear (no backtracking regexes
  # over user input), so pathological 100k-character inputs finish immediately.
  module Address
    MAX_RECIPIENTS = 100
    MAX_RECIPIENT_LENGTH = 320 # the server rejects anything longer
    BAD_CHARS = /[\r\n\0]/
    NON_ADDRESS = /[<>\s]/
    ANGLE = /[<>]/

    module_function

    # Splits "Name <a@b.com>" into its parts; passes Hashes and bare addresses through.
    # @return [Hash{Symbol=>String}] `{ email:, name: }` (name omitted when absent)
    def parse(value, field)
      result =
        if value.is_a?(Hash)
          parse_hash(value, field)
        else
          text = Util.utf8(value)
          if text.nil? || Util.blank?(text)
            raise ValidationError, %("#{field}" must be a non-empty string or { email:, name: })
          end
          raise ValidationError, %("#{field}" contains a line break or NUL character) if text.include?("\0")

          stripped = text.strip
          named(stripped) || { email: stripped }
        end
      if (result[:email] + result[:name].to_s).match?(BAD_CHARS)
        raise ValidationError, %("#{field}" contains a line break or NUL character)
      end

      result
    end

    # Validates a recipient list and returns it as an Array of Strings (nil when optional and empty).
    def recipients(value, field, required)
      if value.nil?
        raise ValidationError, %("#{field}" is required) if required

        return nil
      end
      list = value.is_a?(Array) ? value : [value]
      cleaned = list.map do |entry|
        text = Util.utf8(entry)
        raise ValidationError, %("#{field}" must be a string or an array of strings) if text.nil?
        raise ValidationError, %("#{field}" contains a line break or NUL character) if text.include?("\0")

        text.strip
      end.reject(&:empty?)
      if cleaned.empty?
        raise ValidationError, %("#{field}" must contain at least one address) if required

        return nil
      end
      if cleaned.length > MAX_RECIPIENTS
        raise ValidationError, %("#{field}" has #{cleaned.length} addresses (maximum #{MAX_RECIPIENTS}))
      end

      cleaned.each do |addr|
        raise ValidationError, %("#{field}" contains a line break or NUL character) if addr.match?(BAD_CHARS)
        unless addr.include?('@')
          raise ValidationError, %("#{field}" contains an invalid address: #{Util.snippet(addr).inspect})
        end
        if addr.length > MAX_RECIPIENT_LENGTH
          raise ValidationError, %("#{field}" contains an address longer than #{MAX_RECIPIENT_LENGTH} characters)
        end
      end
      cleaned
    end

    def parse_hash(value, field)
      h = value.each_with_object({}) { |(k, v), acc| acc[k.to_s] = v if k.is_a?(String) || k.is_a?(Symbol) }
      email = Util.utf8(h['email'])
      raise ValidationError, %("#{field}.email" must be a non-empty string) if email.nil? || Util.blank?(email)

      unless (h.keys - %w[email name]).empty?
        raise ValidationError, %("#{field}" has unknown keys: #{(h.keys - %w[email name]).first(5).join(', ')})
      end
      result = { email: email.strip }
      unless h['name'].nil?
        name = Util.utf8(h['name'])
        raise ValidationError, %("#{field}.name" must be a string) if name.nil?

        result[:name] = name.strip unless name.strip.empty?
      end
      result
    end

    # Matches `Name <addr>`, `"Name" <addr>` and `<addr>`; returns nil when +text+ is not of that shape.
    def named(text)
      return nil unless text.end_with?('>')

      lt = text.rindex('<')
      return nil if lt.nil?

      addr = text[(lt + 1)...-1].strip
      return nil if addr.empty? || addr.match?(NON_ADDRESS)

      name = text[0, lt].strip
      return nil if name.match?(ANGLE)

      name = name[1..] if name.start_with?('"')
      name = name[0...-1] if name.end_with?('"')
      return nil if name.include?('"')

      name = name.strip
      name.empty? ? { email: addr } : { email: addr, name: name }
    end
  end
end
