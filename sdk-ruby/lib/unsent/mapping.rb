# frozen_string_literal: true

module Unsent
  # Converts the API's snake_case JSON into the SDK's model objects. Tolerates missing and wrongly typed
  # fields (a hostile or buggy server cannot crash it), but raises {Error} with code "invalid_response" when
  # a payload is not even the right container type.
  module Mapping
    module_function

    def invalid!(what)
      raise Error.new("Unexpected response from the server: #{what}. Is base_url pointing at your Unsent deployment?",
                      code: 'invalid_response')
    end

    def hash!(value, what)
      invalid!("#{what} is not a JSON object") unless value.is_a?(Hash)
      value
    end

    def str_array(value)
      value.is_a?(Array) ? value.select { |x| x.is_a?(String) } : nil
    end

    def base64_size(content)
      padding = content.length - content.sub(/=+\z/, '').length
      [((content.length * 3) / 4) - padding, 0].max
    end

    def failover(raw)
      list = raw
      if raw.is_a?(String)
        list = begin
          JSON.parse(raw)
        rescue JSON::ParserError, EncodingError
          return []
        end
      end
      return [] unless list.is_a?(Array)

      list.map do |f|
        f = {} unless f.is_a?(Hash)
        FailoverAttempt.new(provider: Util.to_text(f['provider']), type: Util.to_text(f['type']),
                            error: Util.to_text(f['error']), timestamp: Util.to_time(f['timestamp']))
      end
    end

    def base(wire)
      html = wire['html_body'].is_a?(String) ? wire['html_body'] : (wire['body'].is_a?(String) ? wire['body'] : '')
      # The API falls back to the HTML body when no plain-text alternative was stored.
      text = wire['text_body']
      text = nil unless text.is_a?(String) && !text.empty? && text != html
      status = wire['status']
      {
        id: Util.to_int(wire['id']),
        status: EMAIL_STATUSES.include?(status) ? status : 'queued',
        to: str_array(wire['to']) || [],
        cc: str_array(wire['cc']),
        bcc: str_array(wire['bcc']),
        subject: Util.to_text(wire['subject']),
        html_body: html,
        text_body: text,
        from_email: opt_text(wire['from_email']),
        from_name: opt_text(wire['from_name']),
        provider_id: opt_text(wire['provider_id']),
        provider_used: opt_text(wire['provider_used']),
        failover_history: failover(wire['failover_history']),
        idempotency_key: opt_text(wire['idempotency_key']),
        attempts: Util.to_int(wire['attempts']),
        error: opt_text(wire['error']),
        created_at: Util.to_time(wire['created_at']),
        updated_at: Util.to_time(wire['updated_at'])
      }
    end

    def opt_text(value)
      value.nil? ? nil : Util.to_text(value)
    end

    def attachments(wire)
      list = wire['attachments']
      list.is_a?(Array) ? list : []
    end

    # List rows: attachments carry metadata only.
    def email(wire)
      infos = attachments(wire).map do |a|
        a = {} unless a.is_a?(Hash)
        size = if a['size'].is_a?(Numeric) && a['size'].respond_to?(:finite?) && a['size'].finite?
                 a['size'].to_i
               elsif a['content'].is_a?(String)
                 base64_size(a['content'])
               else
                 0
               end
        AttachmentInfo.new(filename: Util.to_text(a['filename']), mime_type: opt_text(a['mimeType']), size: size)
      end
      Email.new(**base(wire), attachments: infos).freeze
    end

    # Detail response: attachments include their content.
    def email_detail(wire)
      details = attachments(wire).map do |a|
        a = {} unless a.is_a?(Hash)
        content = a['content'].is_a?(String) ? a['content'] : ''
        AttachmentDetail.new(filename: Util.to_text(a['filename']), mime_type: opt_text(a['mimeType']),
                             size: base64_size(content), content: content)
      end
      EmailDetail.new(**base(wire), attachments: details).freeze
    end
  end
end
