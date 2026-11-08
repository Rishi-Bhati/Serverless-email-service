//go:build go1.23

package unsent

import (
	"context"
	"iter"
)

// All returns a Go 1.23 range-over-func iterator over every matching email. A failure is yielded
// once as the error value and ends the sequence:
//
//	for email, err := range client.Emails.All(ctx, nil) {
//		if err != nil { return err }
//	}
func (e *Emails) All(ctx context.Context, params *ListParams, opts ...CallOption) iter.Seq2[Email, error] {
	return func(yield func(Email, error) bool) {
		it := e.Iterate(ctx, params, opts...)
		for it.Next(ctx) {
			if !yield(it.Email(), nil) {
				return
			}
		}
		if err := it.Err(); err != nil {
			yield(Email{}, err)
		}
	}
}
