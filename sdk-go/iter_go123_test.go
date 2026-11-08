//go:build go1.23

package unsent_test

import (
	"testing"

	unsent "github.com/Rishi-Bhati/Serverless-email-service/sdk-go"
)

func TestAllRangeOverFunc(t *testing.T) {
	e := setup(t, pagedHandler(5))
	var ids []int64
	for em, err := range e.C.Emails.All(bg, &unsent.ListParams{Limit: 2}) {
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, em.ID)
		if em.ID == 4 {
			break // early exit must be honoured
		}
	}
	eq(t, ids, []int64{1, 2, 3, 4}, "ids")
	eq(t, e.M.N(), 2, "pages fetched (no fetch after break)")

	n, errs := 0, 0
	for _, err := range setup(t, okHandler(1)).C.Emails.All(bg, &unsent.ListParams{Limit: 999}) {
		n++
		if err != nil {
			errs++
		}
	}
	eq(t, []int{n, errs}, []int{1, 1}, "error yielded once")
}
