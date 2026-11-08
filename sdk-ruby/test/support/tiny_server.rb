# frozen_string_literal: true

require 'socket'

# A minimal threaded HTTP/1.1 server for exercising the real Net::HTTP transport against hostile or scripted
# peers. The handler receives (request_line, headers, body, socket) and either returns a raw response String
# (written, then the connection is closed) or writes to the socket itself and returns nil.
class TinyServer
  attr_reader :port, :requests

  def initialize(&handler)
    @handler = handler
    @server = TCPServer.new('127.0.0.1', 0)
    @port = @server.addr[1]
    @requests = []
    @lock = Mutex.new
    @threads = []
    @running = true
    @acceptor = Thread.new { accept_loop }
  end

  def base_url
    "http://127.0.0.1:#{port}"
  end

  def stop
    @running = false
    @server.close unless @server.closed?
    @acceptor.kill
    @threads.each(&:kill)
  end

  def self.http(status, body = '', headers = {})
    head = { 'Content-Length' => body.bytesize.to_s, 'Connection' => 'close' }.merge(headers)
    "HTTP/1.1 #{status} X\r\n#{head.map { |k, v| "#{k}: #{v}\r\n" }.join}\r\n#{body}"
  end

  private

  def accept_loop
    while @running
      sock = @server.accept
      @threads << Thread.new(sock) { |s| serve(s) }
    end
  rescue IOError, Errno::EBADF
    nil
  end

  def serve(sock)
    line = sock.gets("\r\n")
    return sock.close if line.nil?

    headers = {}
    while (h = sock.gets("\r\n")) && h != "\r\n"
      k, v = h.chomp.split(': ', 2)
      headers[k.downcase] = v
    end
    body = headers['content-length'] ? sock.read(headers['content-length'].to_i) : ''
    @lock.synchronize { @requests << { line: line.chomp, headers: headers, body: body } }
    out = @handler.call(line.chomp, headers, body, sock)
    sock.write(out) if out
  rescue IOError, SystemCallError
    nil
  ensure
    begin
      sock.close unless sock.closed?
    rescue IOError
      nil
    end
  end
end
