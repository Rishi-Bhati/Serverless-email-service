# frozen_string_literal: true

# Seeded generator of hostile / nonsensical Ruby values.
class Junk
  Weird = Class.new do
    def to_s = raise('to_s boom')
    def inspect = raise('inspect boom')
    def to_str = raise('to_str boom')
    def to_hash = raise('to_hash boom')
    def to_a = raise('to_a boom')
    def respond_to_missing?(*) = raise('respond_to boom')
    def ==(_other) = raise('== boom')
  end

  Plain = Class.new

  UNICODE = ["é", "日本語", "\u{1F389}", "‮", "\u0000", "​", "﻿", "á", "\u{10FFFF}"].freeze
  NASTY = ["\r\n", "\n", "\r", "\0", "\t", "\e[31m", "%s%n", "{{x}}", "' OR 1=1 --", '<script>', '../../etc/passwd', '"', "'",
           '\\', 'null', '__proto__', 'constructor', '{"a":1}', '=', '&', '?', '#', ' ', " "].freeze

  attr_reader :rng

  def initialize(seed)
    @rng = Random.new(seed)
  end

  def int(max) = rng.rand(max)
  def chance(p) = rng.rand < p
  def pick(list) = list[rng.rand(list.length)]

  def string(max = 40)
    case int(12)
    when 0 then ''
    when 1 then pick(NASTY)
    when 2 then pick(UNICODE) * (1 + int(5))
    when 3 then Array.new(int(max)) { pick(NASTY + UNICODE) }.join
    when 4 then Array.new(int(max)) { rng.rand(256).chr }.join.b
    when 5 then Array.new(int(max)) { rng.rand(256).chr }.join.force_encoding('UTF-8')
    when 6 then "user#{int(100)}@example.com"
    when 7 then "#{pick(%w[Acme Jane])} <u#{int(999)}@x.co>"
    when 8 then pick(NASTY) + ('a' * (chance(0.03) ? 20_000 + int(180_000) : int(300))) + pick(NASTY)
    when 9 then ['QQ==', 'aGVsbG8=', "aGVs\nbG8=", 'AAAA', '===='].sample(random: rng)
    when 10 then Array.new(int(max)) { (97 + int(26)).chr }.join.encode(pick([Encoding::UTF_16LE, Encoding::ISO_8859_1, Encoding::UTF_8, Encoding::US_ASCII]), invalid: :replace, undef: :replace)
    else Array.new(int(max)) { (32 + int(95)).chr }.join
    end
  end

  def number
    pick([0, 1, -1, 3, 200, 201, 2**53, 2**64, -2**63, 1.5, -0.0, Float::NAN, Float::INFINITY, -Float::INFINITY, 1e308, 1e-320,
          Rational(1, 3), Complex(1, 2), 10**30, 0.0001, 100_000])
  end

  def scalar
    case int(9)
    when 0 then nil
    when 1 then true
    when 2 then false
    when 3 then number
    when 4 then pick(%i[sent queued to :x a@b.co]).to_sym
    when 5 then Time.at(int(2**31))
    when 6 then pick([Object.new, Plain.new, Weird.new, Class, Kernel, :sym, 1..2, proc {}, method(:puts), $stdout, StringIO.new('x'), Struct.new(:a).new(1)])
    else string
    end
  end

  def value(depth = 0)
    return scalar if depth > 3 || chance(0.6)

    case int(3)
    when 0 then Array.new(int(6)) { value(depth + 1) }
    when 1 then Array.new(int(5)) { [key, value(depth + 1)] }.to_h
    else string
    end
  end

  def key
    case int(6)
    when 0, 1, 2 then pick(%i[to cc bcc subject html text from attachments provider_id idempotency_key timeout max_retries cancel limit offset status search sort interval email name filename content content_type])
    when 3 then string(8)
    when 4 then scalar
    else pick(%w[to subject html __proto__ constructor])
    end
  end

  def options(keys)
    h = {}
    int(8).times { h[chance(0.85) ? pick(keys) : key] = value }
    h
  end

  # A mostly-valid send hash with a few junk fields mixed in.
  def send_options
    h = { to: 'a@b.co', subject: 's', html: 'h' }
    h.delete(pick(h.keys)) if chance(0.15)
    (1 + int(3)).times do
      k = pick(%i[to cc bcc subject html text from attachments provider_id idempotency_key timeout max_retries cancel])
      h[k] = case k
             when :attachments then chance(0.5) ? Array.new(int(4)) { attachment } : value
             when :cancel then chance(0.5) ? Unsent::CancelToken.new : value
             when :timeout, :max_retries then chance(0.5) ? [1, 2, 0.5].sample(random: rng) : value
             else value
             end
    end
    h
  end

  def attachment
    return value if chance(0.2)

    h = {}
    h[key_for_attachment] = chance(0.7) ? string : value
    h[:filename] = (chance(0.8) ? string(10) : value) unless chance(0.2)
    h[:content] = (chance(0.5) ? string : value) unless chance(0.1)
    h
  end

  def key_for_attachment = pick(%i[filename content content_type mime_type contentType mimeType]) 

  # An arbitrary JSON-ish structure (what a hostile server might send).
  def json_value(depth = 0)
    case depth > 3 ? int(6) : int(9)
    when 0 then nil
    when 1 then [true, false].sample(random: rng)
    when 2 then pick([0, -1, 2**70, 1.5, 1e300, 3])
    when 3, 4 then string(30).scrub('?')
    when 5 then pick(['queued', 'sent', 'failed', 'sending', 'ok', ''])
    when 6 then Array.new(int(5)) { json_value(depth + 1) }
    else Array.new(int(6)) { [pick(%w[id status to cc bcc subject html_body text_body body error attachments emails total limit offset email
                                      created_at updated_at failover_history attempts idempotency_key idempotent_replay targetProvider message
                                      __proto__ constructor timestamp queued sending sent failed code reason]), json_value(depth + 1)] }.to_h
    end
  end
end
