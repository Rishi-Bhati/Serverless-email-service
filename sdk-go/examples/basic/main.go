// Send one email and wait until it has been delivered.
//
//	UNSENT_BASE_URL=https://unsent.example.com UNSENT_API_KEY=... UNSENT_API_SECRET=... go run ./examples/basic
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET.
	client, err := unsent.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}

	res, err := client.Send(ctx, unsent.SendParams{
		From:    unsent.Addr("Acme <hello@acme.com>"), // must be a sender configured in your Unsent dashboard
		To:      []string{"customer@example.com"},
		Subject: "Welcome to Acme",
		HTML:    "<h1>Welcome!</h1><p>Your account is ready.</p>",
		Text:    "Welcome! Your account is ready.",
		// Optional: makes "send once" survive your own retries (job queues, redeliveries) too.
		IdempotencyKey: "welcome:customer-42",
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("queued as", res.ID, "replay:", res.IdempotentReplay)

	// Optional: wait until it has actually been delivered.
	email, err := client.Emails.Wait(ctx, res.ID, nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(email.Status, email.ProviderUsed)
}
