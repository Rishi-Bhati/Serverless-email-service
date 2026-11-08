package unsent

import (
	"context"
	"time"
)

// Test hooks (compiled only into tests).

func (c *Client) SetClock(now func() time.Time)                               { c.h.now = now }
func (c *Client) SetSleep(f func(ctx context.Context, d time.Duration) error) { c.h.sleep = f }
func (c *Client) SetRand(f func() float64)                                    { c.h.rnd = f }
func (c *Client) ClockOffset() time.Duration {
	return time.Duration(c.h.clockOffsetMs.Load()) * time.Millisecond
}

var (
	SignRequest        = signRequest
	NormalizeBase64    = normalizeBase64
	ValidIdemKey       = validIdempotencyKey
	NormalizeBaseURL   = normalizeBaseURL
	ParseRetryAfterFor = parseRetryAfter
)
