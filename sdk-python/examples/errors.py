"""Handle errors and safely retry a business operation with a stable idempotency key.

    python examples/errors.py
"""

from unsent import (
    Unsent,
    UnsentAPIError,
    UnsentConflictError,
    UnsentConnectionError,
    UnsentValidationError,
)


def send_invoice(unsent: Unsent, invoice_id: int, to: str) -> int:
    """Return the email id for an invoice, deduplicated across our own retries."""
    try:
        result = unsent.send(
            to=to,
            subject=f"Invoice #{invoice_id}",
            text="Thank you for your business.",
            idempotency_key=f"invoice-{invoice_id}:email",
        )
        return result.id
    except UnsentValidationError as err:
        # The arguments are wrong; retrying cannot help.
        print("invalid input:", err.code, err.message)
        raise
    except UnsentConflictError as err:
        # Same key, different message: someone else already used this key.
        print("conflict with email", err.existing_email_id)
        raise
    except UnsentConnectionError as err:
        # The SDK already retried. A transient failure; let the queue try again later.
        print("temporary failure:", err.code, "->", err.__cause__)
        raise
    except UnsentAPIError as err:
        print("server said:", err.status, err.code, err.reason)
        print("hint:", err.hint)
        raise


def main() -> None:
    unsent = Unsent()
    print("queued as", send_invoice(unsent, 8492, "customer@example.com"))


if __name__ == "__main__":
    main()
