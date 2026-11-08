// Look at what the service has stored: Get, List, Iterate, Status and Health.
package main

import (
	"context"
	"fmt"
	"log"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func main() {
	ctx := context.Background()
	client, err := unsent.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}

	st, err := client.Status(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("queued=%d sending=%d sent=%d failed=%d\n", st.Queued, st.Sending, st.Sent, st.Failed)

	page, err := client.Emails.List(ctx, &unsent.ListParams{Status: unsent.StatusFailed, From: "2026-01-01", Limit: 50})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(len(page.Emails), "of", page.Total, "failed emails; more:", page.HasMore)

	// Every match, page by page (oldest first so new mail does not shift pages).
	it := client.Emails.Iterate(ctx, &unsent.ListParams{Status: unsent.StatusFailed})
	for it.Next(ctx) {
		e := it.Email()
		fmt.Println(e.ID, e.Subject, e.Error)
	}
	if err := it.Err(); err != nil {
		log.Fatal(err)
	}

	if page.Total > 0 {
		email, err := client.Emails.Get(ctx, page.Emails[0].ID) // includes attachment content
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(email.Status, email.FailoverHistory)
	}
}
