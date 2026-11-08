# frozen_string_literal: true

module Unsent
  # Attachment helpers. An attachment is a Hash:
  #
  #   { filename: 'report.csv', content: csv_bytes, content_type: 'text/csv' }
  #
  # `content` is one of:
  # * a binary String (`ASCII-8BIT`, e.g. from `File.binread`, `String#b` or a decoded mail part): raw bytes, encoded for you
  # * any other String (UTF-8, US-ASCII...): **already base64-encoded** text, validated
  # * an IO-like object (File, StringIO, Tempfile...) responding to `read`: its remaining bytes
  module Attachment
    MAX_ATTACHMENTS = 20
    MAX_FILENAME = 255
    MAX_BODY_BYTES = 3 * 1024 * 1024
    BASE64 = %r{\A[A-Za-z0-9+/]*={0,2}\z}

    MIME = {
      '.pdf' => 'application/pdf', '.png' => 'image/png', '.jpg' => 'image/jpeg', '.jpeg' => 'image/jpeg',
      '.gif' => 'image/gif', '.webp' => 'image/webp', '.svg' => 'image/svg+xml', '.txt' => 'text/plain',
      '.csv' => 'text/csv', '.json' => 'application/json', '.html' => 'text/html', '.xml' => 'application/xml',
      '.zip' => 'application/zip', '.doc' => 'application/msword',
      '.docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls' => 'application/vnd.ms-excel',
      '.xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ics' => 'text/calendar'
    }.freeze

    module_function

    # Reads a file from disk as an attachment Hash (filename and content type are guessed from the path).
    #
    #   attachments: [Unsent::Attachment.from_file('./invoice.pdf')]
    def from_file(path, filename: nil, content_type: nil)
      path = path.to_path if Util.responds?(path, :to_path)
      path = Util.utf8(path)
      raise ValidationError, '"path" must be a String or Pathname' if path.nil?
      raise ValidationError, '"path" is not a valid file name' if path.include?("\0") || path.empty?

      begin
        if File.size(path) > MAX_BODY_BYTES
          raise ValidationError.new("#{File.basename(path)} is larger than the 3 MiB request limit",
                                    code: 'payload_too_large')
        end
        content = File.binread(path)
      rescue SystemCallError, IOError, ArgumentError, EncodingError => e
        raise ValidationError, "could not read #{Util.snippet(File.basename(path.to_s), 60)}: #{e.class}"
      end
      { filename: filename || File.basename(path), content: content,
        content_type: content_type || MIME[File.extname(path).downcase] }.compact
    end

    # Validates one attachment and converts it to the API's wire format.
    # @return [Hash] `{ filename:, content: <base64>, mimeType: }`
    def to_wire(att, index)
      at = "attachments[#{index}]"
      raise ValidationError, "#{at} must be a Hash" unless att.is_a?(Hash)

      h = normalize_keys(att, at)
      raw = h['content']
      filename = clean_filename(h['filename'], raw, at)
      content = encode_content(raw, at)
      raise ValidationError, "#{at}.content is empty" if content.empty?

      mime = h['content_type'] || h['mime_type']
      unless mime.nil?
        mime = Util.utf8(mime)
        raise ValidationError, "#{at}.content_type must be a string" if mime.nil?
      end
      mime = nil if mime && mime.strip.empty?
      mime ? { filename: filename, content: content, mimeType: mime.strip } : { filename: filename, content: content }
    end

    def normalize_keys(att, at)
      h = {}
      att.each do |k, v|
        key = nil
        if k.is_a?(Symbol) || k.is_a?(String)
          text = Util.utf8(k.is_a?(Symbol) ? k.to_s : k)
          key = text && canonical_key(text.downcase.delete('_'))
        end
        raise ValidationError, "#{at} has an unsupported key: #{Util.show(k, 30)}" if key.nil?

        h[key] = v
      end
      h
    end

    def canonical_key(squashed)
      case squashed
      when 'filename' then 'filename'
      when 'content' then 'content'
      when 'contenttype' then 'content_type'
      when 'mimetype' then 'mime_type'
      end
    end

    def clean_filename(value, raw, at)
      value = !raw.is_a?(String) && Util.responds?(raw, :path) ? safe_basename(raw) : nil if value.nil?
      name = Util.utf8(value)
      name = name.gsub(/[\r\n\0]/, '').strip if name
      raise ValidationError, "#{at}.filename is required" if name.nil? || name.empty?
      raise ValidationError, "#{at}.filename exceeds #{MAX_FILENAME} characters" if name.length > MAX_FILENAME

      name
    end

    def safe_basename(io)
      path = io.path
      path.is_a?(String) ? File.basename(path) : nil
    rescue StandardError
      nil
    end

    def encode_content(raw, at)
      case raw
      when String
        raw.encoding == Encoding::BINARY ? encode_bytes(raw, at) : validate_base64(raw, at)
      when nil
        raise ValidationError, "#{at}.content is required"
      else
        raise ValidationError, "#{at}.content must be a base64 String, a binary String or an IO" unless Util.responds?(raw, :read)

        bytes = begin
          raw.read
        rescue StandardError => e
          raise ValidationError, "#{at}.content could not be read (#{e.class})"
        end
        raise ValidationError, "#{at}.content#read must return a String" unless bytes.is_a?(String)

        encode_bytes(bytes, at)
      end
    end

    def encode_bytes(bytes, at)
      if bytes.bytesize > MAX_BODY_BYTES
        raise ValidationError.new("#{at} is larger than the 3 MiB request limit", code: 'payload_too_large')
      end

      [bytes].pack('m0')
    end

    def validate_base64(string, at)
      text = Util.utf8(string)
      content = text&.gsub(/\s+/, '')
      if content.nil? || content.empty? || (content.length % 4) != 0 || !content.match?(BASE64)
        raise ValidationError, "#{at}.content is a String, so it must be valid base64. To attach text or binary " \
                               'data, pass a binary String (data.b or File.binread), an IO, or ' \
                               'Unsent::Attachment.from_file(path).'
      end
      if content.length > MAX_BODY_BYTES
        raise ValidationError.new("#{at} is larger than the 3 MiB request limit", code: 'payload_too_large')
      end

      content
    end
  end
end
