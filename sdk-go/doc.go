// Package unsent is the official Go client for a self-hosted Unsent email service.
//
//	client, err := unsent.NewFromEnv() // UNSENT_BASE_URL, UNSENT_API_KEY, UNSENT_API_SECRET
//	if err != nil { ... }
//	res, err := client.Send(ctx, unsent.SendParams{
//		To:      []string{"customer@example.com"},
//		Subject: "Welcome!",
//		HTML:    "<h1>Hello</h1>",
//	})
//
// The client signs requests (HMAC-SHA256), attaches an idempotency key to every send so that
// retries can never deliver the same email twice, retries network errors / 408 / 425 / 429 / 5xx
// with backoff, corrects a skewed local clock, and never follows redirects.
// It depends on the standard library only and is safe for concurrent use.
package unsent
