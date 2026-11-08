// Branch on error kinds with errors.As / errors.Is and the Is* helpers.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func main() {
	client, err := unsent.NewFromEnv()
	if err != nil {
		var cfg *unsent.ConfigError
		if errors.As(err, &cfg) {
			log.Fatalf("misconfigured (%s): %v", cfg.Code, err)
		}
		log.Fatal(err)
	}

	_, err = client.Send(context.Background(), unsent.SendParams{
		To: []string{"customer@example.com"}, Subject: "Order shipped", Text: "On its way.",
		IdempotencyKey: "order-8492:shipped",
	})
	var api *unsent.APIError
	switch {
	case err == nil:
		fmt.Println("sent")
	case unsent.IsValidation(err):
		fmt.Println("bad arguments, nothing was sent:", err)
	case unsent.IsAuthentication(err):
		errors.As(err, &api)
		fmt.Println("check your credentials:", api.Code, api.Hint)
	case unsent.IsConflict(err):
		errors.As(err, &api)
		fmt.Println("key already used for a different email, id", api.ExistingEmailID)
	case unsent.IsTimeout(err), unsent.IsAborted(err), unsent.IsConnection(err):
		fmt.Println("network problem (already retried):", err)
	case errors.As(err, &api):
		fmt.Println("server said", api.Status, api.Code, api.Message)
	default:
		log.Fatal(err)
	}
}
