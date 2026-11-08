# frozen_string_literal: true

module Unsent
  # The default clock. A custom object with the same three methods can be passed as `clock:` to
  # {Client#initialize}; the test suite uses this to run retries and clock-skew scenarios in virtual time.
  class SystemClock
    # @return [Float] Unix time in seconds
    def now
      Time.now.to_f
    end

    # @return [Float] monotonic seconds (for measuring durations)
    def monotonic
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    # Sleeps +seconds+, waking early when +cancel+ (a {CancelToken}) is cancelled.
    def sleep(seconds, cancel = nil)
      return if seconds <= 0

      cancel ? cancel.wait(seconds) : Kernel.sleep(seconds)
      nil
    end
  end
end
