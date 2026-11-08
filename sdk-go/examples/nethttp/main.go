// A net/http handler that sends mail. The same Client is shared by all requests (it is concurrency-safe).
// Gin, Echo, chi and friends work identically: call client.Send(r.Context(), ...) from your handler.
package main

import (
	"encoding/json"
	"log"
	"net/http"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func main() {
	client, err := unsent.NewFromEnv()
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/signup", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		// r.Context() cancels the send (and its retries) if the client goes away.
		res, err := client.Send(r.Context(), unsent.SendParams{
			To:             []string{in.Email},
			Subject:        "Welcome",
			HTML:           "<p>Hi!</p>",
			IdempotencyKey: "welcome:" + in.Email, // double-submits send one email
		})
		switch {
		case err == nil:
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": res.ID})
		case unsent.IsValidation(err):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		default:
			log.Printf("send failed: %v", err) // never contains your API key or secret
			http.Error(w, "could not send", http.StatusBadGateway)
		}
	})
	log.Fatal(http.ListenAndServe(":8080", nil))
}
