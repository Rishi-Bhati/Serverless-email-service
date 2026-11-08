// Attach files from bytes, a reader, a path on disk and pre-encoded base64.
package main

import (
	"bytes"
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

	invoice, err := unsent.AttachmentFromFile("./invoice.pdf") // filename and content type come from the path
	if err != nil {
		log.Fatal(err)
	}

	csv := []byte("id,total\n1,9.99\n")
	res, err := client.Send(ctx, unsent.SendParams{
		To:      []string{"customer@example.com"},
		Subject: "Your invoice",
		HTML:    "<p>Attached.</p>",
		Attachments: []unsent.Attachment{
			invoice,
			{Filename: "report.csv", Content: csv, ContentType: "text/csv"},
			{Filename: "notes.txt", Reader: bytes.NewReader([]byte("streamed")), ContentType: "text/plain"},
			{Filename: "pre.bin", Base64: "AAECAw=="}, // already base64
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	// The service stores body and attachments in one row: keep attachments under ~1.4 MB in total.
	fmt.Println("queued as", res.ID)
}
