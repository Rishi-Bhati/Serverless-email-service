#!/usr/bin/env ruby
# frozen_string_literal: true

# Attaching files: raw bytes, an IO, a base64 String, or Unsent::Attachment.from_file.
#
#   ruby -Ilib examples/attachments.rb
#
# Exits cleanly when the credentials or the sample files are missing.

require 'unsent'
require 'fileutils'
require 'securerandom'
require 'stringio'
require 'tempfile'
require 'tmpdir'

unless ENV['UNSENT_BASE_URL'].to_s != '' && ENV['UNSENT_API_KEY'].to_s != ''
  warn 'Set UNSENT_BASE_URL and UNSENT_API_KEY (and UNSENT_API_SECRET unless your server is api-key-only).'
  exit 0
end

client = Unsent::Client.new
dir = Dir.mktmpdir('unsent-attachments')
begin
  pdf = File.join(dir, 'invoice.pdf')
  File.binwrite(pdf, "%PDF-1.4\n% sample invoice\n".b)

  csv = File.join(dir, 'report.csv')
  File.binwrite(csv, "id,name\n1,Grüße\n")

  result = client.send_email(
    to: 'customer@example.com',
    subject: 'Your invoice',
    html: '<p>Both files are attached.</p>',
    attachments: [
      # From disk: the filename and MIME type are guessed from the path (invoice.pdf -> application/pdf).
      Unsent::Attachment.from_file(pdf),

      # Raw bytes: a *binary* String (ASCII-8BIT) is base64-encoded for you. File.binread / String#b.
      { filename: 'report.csv', content: File.binread(csv), content_type: 'text/csv' },

      # An IO: read fully, its own name supplies the default filename.
      { content: File.open(pdf, 'rb'), filename: 'copy.pdf', content_type: 'application/pdf' },
      { filename: 'memory.txt', content: StringIO.new('from a StringIO'), content_type: 'text/plain' },

      # Already base64: any *non-binary* String is treated as base64 and validated (whitespace is ignored).
      { filename: 'hello.txt', content: 'aGVs bG8=', content_type: 'text/plain' },

      # Options left off: no mimeType is sent, which is fine.
      { filename: 'untitled.bin', content: "\x00\x01\x02".b }
    ]
  )
  puts "queued #{result.id} with 6 attachments"

  # Attachments are bounded: at most 20 per email, and the service stores the body and the attachments in one
  # database row, so keep the total under roughly 1.4 MB of raw attachment data.
  begin
    client.send_email(to: 'customer@example.com', subject: 'too big', html: '<p>x</p>',
                      attachments: [{ filename: 'big.bin', content: SecureRandom.random_bytes(1_600_000).b }])
  rescue Unsent::RequestError => e
    puts "the server refused the oversized email: #{e.code} (HTTP #{e.status})"
  rescue Unsent::ValidationError => e
    puts "the SDK refused the oversized email: #{e.code}"
  end

  # To attach text that is not base64, pass bytes (`.b`) rather than the plain UTF-8 String.
  client.send_email(to: 'customer@example.com', subject: 'notes', html: '<p>see attached</p>',
                    attachments: [{ filename: 'notes.txt', content: "plain text\n".b, content_type: 'text/plain' }])

  # After fetching an email, decode its attachment content back to bytes:
  email = client.emails.get(result.id)
  email.attachments.each do |att|
    puts "  #{att.filename} (#{att.mime_type || 'unknown'}, #{att.size} bytes) -> #{att.data.bytesize} bytes decoded"
  end
ensure
  FileUtils.remove_entry(dir)
end
