# frozen_string_literal: true

module Unsent
  # Cooperative cancellation for in-flight calls. Pass one as `cancel:` to any client method and call
  # {#cancel!} from another thread: the request is dropped, no further attempts are made, and
  # {Unsent::ConnectionError} with code "aborted" is raised. Thread-safe.
  #
  #   token = Unsent::CancelToken.new
  #   Thread.new { sleep 5; token.cancel! }
  #   client.emails.wait(id, cancel: token)
  class CancelToken
    def initialize
      @mutex = Mutex.new
      @cv = ConditionVariable.new
      @cancelled = false
      @listeners = []
    end

    # Cancels the token. Safe to call more than once, from any thread.
    def cancel!
      listeners = nil
      @mutex.synchronize do
        return self if @cancelled

        @cancelled = true
        listeners = @listeners.dup
        @listeners.clear
        @cv.broadcast
      end
      listeners.each { |l| l.call }
      self
    end

    def cancelled?
      @mutex.synchronize { @cancelled }
    end
    alias canceled? cancelled?

    # Sleeps up to +seconds+, waking early on cancellation. Returns true when cancelled.
    def wait(seconds)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
      @mutex.synchronize do
        until @cancelled
          remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
          break if remaining <= 0

          @cv.wait(@mutex, remaining)
        end
        @cancelled
      end
    end

    # @api private
    # Registers a callback fired on cancellation (immediately when already cancelled). Returns a callable that unregisters it.
    def on_cancel(&block)
      fire = false
      @mutex.synchronize do
        if @cancelled
          fire = true
        else
          @listeners << block
        end
      end
      block.call if fire
      -> { @mutex.synchronize { @listeners.delete(block) } }
    end
  end

  # @api private
  # One-shot rendezvous between a worker thread and the thread waiting for its result.
  class Latch
    def initialize
      @mutex = Mutex.new
      @cv = ConditionVariable.new
      @set = false
      @value = nil
    end

    def set(value)
      @mutex.synchronize do
        return false if @set

        @value = value
        @set = true
        @cv.broadcast
        true
      end
    end

    # @return [Array(Boolean, Object)] whether the latch was set within +timeout+ seconds, and its value
    def wait(timeout)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
      @mutex.synchronize do
        until @set
          remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
          break if remaining <= 0

          @cv.wait(@mutex, remaining)
        end
        [@set, @value]
      end
    end
  end
end
